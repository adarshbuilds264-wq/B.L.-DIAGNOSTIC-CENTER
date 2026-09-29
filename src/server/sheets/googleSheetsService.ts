import {
  getGoogleSheetsAccessToken,
  getSpreadsheetId,
  getGoogleSheetsAuthStatus,
  setRuntimeSpreadsheetId,
  SPREADSHEET_TITLE,
} from './googleSheetsAuth';
import {
  WorksheetTabName,
  WORKSHEET_TABS,
  WORKSHEET_HEADERS,
  mapEntityToSheetRow,
} from './googleSheetsMapper';

/**
 * Core Google Sheets REST v4 Service (`googleSheetsService`)
 *
 * Implements:
 * - `initializeGoogleSheets()` / `ensureAllWorksheetsExist()`
 * - `findUserByFirebaseUID()`
 * - `createUserRow()` / `updateUserRow()`
 * - `findBookingByID()`
 * - `createBookingRow()` / `updateBookingRow()`
 * - `createPatientRow()` / `updatePatientRow()`
 * - `createReportMetadataRow()`
 * - `syncTests()` / `syncPackages()`
 * - `upsertRecordsToWorksheet()` with strict duplicate prevention
 */

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3/files';

/**
 * Find or create the spreadsheet "B.L. Diagnostic Center - Website Database" when connected via OAuth
 * if GOOGLE_SHEETS_SPREADSHEET_ID is not yet set in `.env`.
 */
export async function findOrCreateDatabaseSpreadsheet(overrideToken?: string): Promise<string> {
  const existingId = getSpreadsheetId();
  if (existingId) {
    return existingId;
  }

  const token = await getGoogleSheetsAccessToken(overrideToken);

  // 1. Search Google Drive for an existing spreadsheet with the official title
  try {
    const queryStr = `name = '${SPREADSHEET_TITLE.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
    const driveRes = await fetch(
      `${DRIVE_API_BASE}?q=${encodeURIComponent(queryStr)}&fields=files(id,name)&pageSize=5`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (driveRes.ok) {
      const driveData = (await driveRes.json()) as { files?: { id: string; name: string }[] };
      if (driveData.files && driveData.files.length > 0 && driveData.files[0].id) {
        const foundId = driveData.files[0].id;
        setRuntimeSpreadsheetId(foundId);
        return foundId;
      }
    }
  } catch (e) {
    console.warn('Could not search Drive for existing spreadsheet, creating new spreadsheet:', e);
  }

  // 2. Create a new Google Spreadsheet with all official tabs, frozen row 1
  const createRes = await fetch(SHEETS_API_BASE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        title: SPREADSHEET_TITLE,
      },
      sheets: WORKSHEET_TABS.map((tabTitle) => ({
        properties: {
          title: tabTitle,
          gridProperties: {
            frozenRowCount: 1,
            rowCount: 1000,
            columnCount: Math.max(WORKSHEET_HEADERS[tabTitle].length + 2, 14),
          },
        },
      })),
    }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => '');
    throw new Error(`Failed to create Google Spreadsheet (${createRes.status}): ${errText.slice(0, 200)}`);
  }

  const createdData = (await createRes.json()) as { spreadsheetId: string };
  if (!createdData.spreadsheetId) {
    throw new Error('Google Sheets API did not return a spreadsheetId.');
  }

  setRuntimeSpreadsheetId(createdData.spreadsheetId);
  return createdData.spreadsheetId;
}

/**
 * Initialize Google Sheets: ensures the spreadsheet and all official worksheet tabs exist,
 * writes Row 1 column headers, freezes Row 1, bolds the header cells, and sets readable column widths.
 */
export async function initializeGoogleSheets(overrideToken?: string): Promise<{
  success: boolean;
  spreadsheetId?: string;
  spreadsheetTitle: string;
  ensuredTabs: WorksheetTabName[];
  error?: string;
}> {
  const spreadsheetId = getSpreadsheetId() || (await findOrCreateDatabaseSpreadsheet(overrideToken));
  const token = await getGoogleSheetsAccessToken(overrideToken);

  // 1. Fetch spreadsheet metadata to inspect existing sheets and their numeric sheetIds
  const metaRes = await fetch(
    `${SHEETS_API_BASE}/${spreadsheetId}?fields=sheets.properties(sheetId,title,gridProperties.frozenRowCount)`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!metaRes.ok) {
    const errText = await metaRes.text().catch(() => '');
    throw new Error(`Failed to read spreadsheet metadata (${metaRes.status}): ${errText.slice(0, 200)}`);
  }

  const metaJson = (await metaRes.json()) as {
    sheets?: { properties?: { sheetId?: number; title?: string; gridProperties?: { frozenRowCount?: number } } }[];
  };

  const existingTitleToId = new Map<string, number>();
  for (const s of metaJson.sheets || []) {
    if (s.properties?.title && typeof s.properties?.sheetId === 'number') {
      existingTitleToId.set(s.properties.title, s.properties.sheetId);
    }
  }

  const missingTabs = WORKSHEET_TABS.filter((tab) => !existingTitleToId.has(tab));

  // 2. Batch create any missing tabs with frozenRowCount: 1
  if (missingTabs.length > 0) {
    const batchRes = await fetch(`${SHEETS_API_BASE}/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: missingTabs.map((title) => ({
          addSheet: {
            properties: {
              title,
              gridProperties: { frozenRowCount: 1 },
            },
          },
        })),
      }),
    });

    if (!batchRes.ok) {
      const errText = await batchRes.text().catch(() => '');
      throw new Error(`Failed to create worksheet tabs (${batchRes.status}): ${errText.slice(0, 200)}`);
    }

    const batchJson = (await batchRes.json()) as {
      replies?: { addSheet?: { properties?: { sheetId?: number; title?: string } } }[];
    };
    for (const reply of batchJson.replies || []) {
      const p = reply.addSheet?.properties;
      if (p?.title && typeof p?.sheetId === 'number') {
        existingTitleToId.set(p.title, p.sheetId);
      }
    }
  }

  // 3. Ensure Row 1 headers on all official tabs via values:batchUpdate
  const headerData = WORKSHEET_TABS.map((tab) => ({
    range: `${tab}!A1`,
    majorDimension: 'ROWS',
    values: [WORKSHEET_HEADERS[tab]],
  }));

  await fetch(`${SHEETS_API_BASE}/${spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: headerData,
    }),
  });

  // 4. Format headers (Freeze Row 1, Bold header text, Navy background #0F294A with white text, readable column width 160px)
  const formatRequests: any[] = [];
  for (const tab of WORKSHEET_TABS) {
    const sheetId = existingTitleToId.get(tab);
    if (typeof sheetId !== 'number') continue;
    const colCount = WORKSHEET_HEADERS[tab].length;

    formatRequests.push(
      {
        updateSheetProperties: {
          properties: {
            sheetId,
            gridProperties: { frozenRowCount: 1 },
          },
          fields: 'gridProperties.frozenRowCount',
        },
      },
      {
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: colCount,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.06, green: 0.16, blue: 0.29 },
              textFormat: {
                bold: true,
                foregroundColor: { red: 1, green: 1, blue: 1 },
              },
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat)',
        },
      },
      {
        updateDimensionProperties: {
          range: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: 0,
            endIndex: colCount,
          },
          properties: {
            pixelSize: 165,
          },
          fields: 'pixelSize',
        },
      }
    );
  }

  if (formatRequests.length > 0) {
    await fetch(`${SHEETS_API_BASE}/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests: formatRequests }),
    }).catch(() => {});
  }

  return {
    success: true,
    spreadsheetId,
    spreadsheetTitle: SPREADSHEET_TITLE,
    ensuredTabs: WORKSHEET_TABS,
  };
}

export async function ensureAllWorksheetsExist(): Promise<{
  success: boolean;
  ensuredTabs: WorksheetTabName[];
  spreadsheetId?: string;
  error?: string;
}> {
  const authStatus = getGoogleSheetsAuthStatus();
  if (!authStatus.configured && !authStatus.oauthConnected) {
    return {
      success: false,
      ensuredTabs: [],
      error:
        'Google Sheets credentials are not configured. Configure GOOGLE_SHEETS_SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, and GOOGLE_PRIVATE_KEY in .env or connect via Google OAuth in /admin/google-sheets.',
    };
  }

  return initializeGoogleSheets();
}

/**
 * Find an existing user row in the `Users` worksheet by Firebase UID (Column B) or User ID (Column A).
 */
export async function findUserByFirebaseUID(
  firebaseUid: string,
  overrideToken?: string,
  mobileNumber?: string
): Promise<{ rowNumber: number; values: string[] } | null> {
  if (!firebaseUid && !mobileNumber) return null;
  const spreadsheetId = getSpreadsheetId();
  if (!spreadsheetId) return null;
  const token = await getGoogleSheetsAccessToken(overrideToken);

  const res = await fetch(
    `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent('Users!A1:J2000')}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  if (!res.ok) return null;

  const data = (await res.json()) as { values?: string[][] };
  const rows = data.values || [];
  const target = (firebaseUid || '').trim();
  const targetMobile = (mobileNumber || '').trim();

  for (let idx = 1; idx < rows.length; idx++) {
    const row = rows[idx] || [];
    const colA = String(row[0] || '').trim(); // User ID (USR-XXXXXX)
    const colC = String(row[2] || '').trim(); // Mobile Number (+91XXXXXXXXXX)
    if (
      (target && colA === target) ||
      (targetMobile && (colC === targetMobile || colA === targetMobile))
    ) {
      return { rowNumber: idx + 1, values: row };
    }
  }
  return null;
}

/**
 * Find an existing booking row in the `Bookings` worksheet by Booking ID (Column A).
 */
export async function findBookingByID(
  bookingId: string,
  overrideToken?: string
): Promise<{ rowNumber: number; values: string[] } | null> {
  if (!bookingId) return null;
  const spreadsheetId = getSpreadsheetId();
  if (!spreadsheetId) return null;
  const token = await getGoogleSheetsAccessToken(overrideToken);

  const res = await fetch(
    `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent('Bookings!A1:M2000')}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  if (!res.ok) return null;

  const data = (await res.json()) as { values?: string[][] };
  const rows = data.values || [];
  const target = bookingId.trim();

  for (let idx = 1; idx < rows.length; idx++) {
    const row = rows[idx] || [];
    if (String(row[0] || '').trim() === target) {
      return { rowNumber: idx + 1, values: row };
    }
  }
  return null;
}

/**
 * Upsert (Update if ID exists, Append if new) a single record or batch of records into a Google Sheet tab.
 *
 * DUPLICATE PROTECTION:
 * - For `Users`: inspects Column A (`User ID`) and Column C (`Mobile Number`)
 *   so a user with the same mobile number or User ID is ALWAYS updated in place and never duplicated.
 * - For all other tabs (`Patients`, `Bookings`, `Booking_Items`, `Tests`, `Packages`, `Reports`, etc.):
 *   inspects Column A (Primary ID). If exists -> UPDATE in place; if not -> APPEND new row.
 */
export async function upsertRecordsToWorksheet(
  tab: WorksheetTabName,
  records: Record<string, any>[],
  overrideToken?: string
): Promise<{
  syncedCount: number;
  updatedCount: number;
  appendedCount: number;
}> {
  if (!records || records.length === 0) {
    return { syncedCount: 0, updatedCount: 0, appendedCount: 0 };
  }

  let spreadsheetId = getSpreadsheetId();
  const token = await getGoogleSheetsAccessToken(overrideToken);
  if (!spreadsheetId) {
    spreadsheetId = await findOrCreateDatabaseSpreadsheet(token);
  }

  // Read Columns A..C for Users tab so Column A (User ID) and Column C (Mobile Number) are checked
  const keyRange = tab === 'Users' ? `${tab}!A:C` : `${tab}!A:A`;
  let keyRes = await fetch(
    `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(keyRange)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  let existingRows: string[][] = [];
  if (keyRes.ok) {
    const keyJson = (await keyRes.json()) as { values?: string[][] };
    existingRows = keyJson.values || [];
  } else {
    // Tab might not exist yet; initialize sheets
    await initializeGoogleSheets(token);
  }

  // Ensure Header Row exists if sheet is completely empty
  if (existingRows.length === 0) {
    const headers = WORKSHEET_HEADERS[tab];
    await fetch(
      `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(
        `${tab}!A1`
      )}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          range: `${tab}!A1`,
          majorDimension: 'ROWS',
          values: [headers],
        }),
      }
    );
    existingRows = [headers];
  }

  const keyToRowNumber = new Map<string, number>();
  existingRows.forEach((r, idx) => {
    if (idx === 0 || !r) return;
    const rowNumber = idx + 1; // 1-indexed sheet row
    const colA = r[0] ? String(r[0]).trim() : '';
    const colC = r[2] ? String(r[2]).trim() : '';
    if (colA) keyToRowNumber.set(colA, rowNumber);
    if (tab === 'Users' && colC) keyToRowNumber.set(colC, rowNumber);
  });

  const rowsToAppend: (string | number)[][] = [];
  const rowsToUpdate: { range: string; values: (string | number)[][] }[] = [];

  for (const record of records) {
    const mappedRow = mapEntityToSheetRow(tab, record);
    const primaryId = String(mappedRow[0] || '').trim();
    const mobileId = tab === 'Users' ? String(mappedRow[2] || '').trim() : '';
    if (!primaryId && !mobileId) continue;

    const existingRowIndex =
      (mobileId ? keyToRowNumber.get(mobileId) : undefined) ??
      keyToRowNumber.get(primaryId);

    if (existingRowIndex) {
      rowsToUpdate.push({
        range: `${tab}!A${existingRowIndex}`,
        values: [mappedRow],
      });
    } else {
      rowsToAppend.push(mappedRow);
      const newRowNum = existingRows.length + rowsToAppend.length;
      if (primaryId) keyToRowNumber.set(primaryId, newRowNum);
      if (mobileId) keyToRowNumber.set(mobileId, newRowNum);
    }
  }

  // Execute in-place updates via values:batchUpdate
  if (rowsToUpdate.length > 0) {
    const updateRes = await fetch(`${SHEETS_API_BASE}/${spreadsheetId}/values:batchUpdate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: rowsToUpdate,
      }),
    });

    if (!updateRes.ok) {
      const errText = await updateRes.text().catch(() => '');
      throw new Error(`Google Sheets batchUpdate failed on ${tab} (${updateRes.status}): ${errText.slice(0, 200)}`);
    }
  }

  // Execute appends for new records
  if (rowsToAppend.length > 0) {
    const appendRes = await fetch(
      `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(
        `${tab}!A1`
      )}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          majorDimension: 'ROWS',
          values: rowsToAppend,
        }),
      }
    );

    if (!appendRes.ok) {
      const errText = await appendRes.text().catch(() => '');
      throw new Error(`Google Sheets append failed on ${tab} (${appendRes.status}): ${errText.slice(0, 200)}`);
    }
  }

  return {
    syncedCount: rowsToUpdate.length + rowsToAppend.length,
    updatedCount: rowsToUpdate.length,
    appendedCount: rowsToAppend.length,
  };
}

// ============================================================================
// EXPLICIT ENTITY HELPER METHODS REQUIRED BY SPECIFICATION
// ============================================================================

export async function createUserRow(user: Record<string, any>, token?: string) {
  return upsertRecordsToWorksheet('Users', [user], token);
}

export async function updateUserRow(user: Record<string, any>, token?: string) {
  return upsertRecordsToWorksheet('Users', [user], token);
}

/**
 * Synchronize a newly registered or updated user from the primary database to the 'Users' worksheet.
 * Checks by Firebase UID (Column B) and User ID (Column A) to prevent duplicate user rows.
 */
export async function syncUserRegistrationToUsersSheet(
  userRecord: {
    userId: string;
    firebaseUid: string;
    fullName: string;
    email: string;
    phone: string;
    role?: string;
    accountStatus?: string;
    registrationDate?: string;
    lastLogin?: string;
    createdAt?: string;
    updatedAt?: string;
  },
  token?: string
) {
  const now = new Date().toISOString();
  const existing = await findUserByFirebaseUID(
    userRecord.firebaseUid,
    token,
    userRecord.phone
  );

  const normalizedPayload = {
    user_id: userRecord.userId || (existing?.values?.[0] ?? ''),
    firebase_uid: userRecord.firebaseUid,
    full_name: userRecord.fullName,
    email: userRecord.email,
    phone: userRecord.phone,
    role: userRecord.role || 'USER',
    account_status: userRecord.accountStatus || 'ACTIVE',
    registration_date:
      userRecord.registrationDate || existing?.values?.[7] || userRecord.createdAt || now,
    last_login: userRecord.lastLogin || now,
    created_at: userRecord.createdAt || existing?.values?.[9] || now,
    updated_at: userRecord.updatedAt || now,
  };

  if (existing) {
    return updateUserRow(normalizedPayload, token);
  }
  return createUserRow(normalizedPayload, token);
}

export async function createBookingRow(booking: Record<string, any>, token?: string) {
  return upsertRecordsToWorksheet('Bookings', [booking], token);
}

export async function updateBookingRow(booking: Record<string, any>, token?: string) {
  return upsertRecordsToWorksheet('Bookings', [booking], token);
}

/**
 * Synchronize a booking (and its associated booking items / home collection details) from the primary database
 * to the 'Bookings', 'Booking_Items', and 'Home_Collection' worksheets.
 * Checks by Booking ID (Column A) and Item ID (Column A) to prevent duplicate rows.
 */
export async function syncBookingToBookingsSheet(
  bookingRecord: Record<string, any>,
  token?: string
) {
  const bookingId = String(
    bookingRecord.booking_id || bookingRecord.booking_number || bookingRecord.id || ''
  ).trim();
  const userId = String(bookingRecord.user_id || bookingRecord.userId || '').trim();
  const patientId = String(
    bookingRecord.patient_id || bookingRecord.patientId || bookingRecord.patient?.id || ''
  ).trim();
  const existing = bookingId ? await findBookingByID(bookingId, token) : null;

  const bookingResult = existing
    ? await updateBookingRow(bookingRecord, token)
    : await createBookingRow(bookingRecord, token);

  // Also sync Booking_Items if items array is present
  const items = Array.isArray(bookingRecord.items)
    ? bookingRecord.items
    : Array.isArray(bookingRecord.tests)
    ? bookingRecord.tests
    : [];

  let itemsSyncedCount = 0;
  if (items.length > 0 && bookingId) {
    const now = bookingRecord.created_at || bookingRecord.createdAt || new Date().toISOString();
    const mappedItems = items.map((it: any, index: number) => ({
      id: it.booking_item_id || it.item_id || it.id || `${bookingId}-ITEM-${index + 1}`,
      item_id: it.booking_item_id || it.item_id || it.id || `${bookingId}-ITEM-${index + 1}`,
      booking_item_id: it.booking_item_id || it.item_id || it.id || `${bookingId}-ITEM-${index + 1}`,
      booking_id: bookingId,
      user_id: it.user_id || userId,
      patient_id: it.patient_id || patientId,
      test_id: it.test_id || it.id || '',
      test_name: it.test_name_snapshot || it.test_name || it.name || '',
      test_name_snapshot: it.test_name_snapshot || it.test_name || it.name || '',
      category: it.category_snapshot || it.category || 'Clinical Pathology',
      category_snapshot: it.category_snapshot || it.category || 'Clinical Pathology',
      price: Number(it.price_snapshot ?? it.price ?? 0),
      price_snapshot: Number(it.price_snapshot ?? it.price ?? 0),
      sample_type:
        it.sample_type_snapshot || it.sample_type || it.sample || it.method_snapshot || it.method || 'Blood',
      sample_type_snapshot:
        it.sample_type_snapshot || it.sample_type || it.sample || it.method_snapshot || it.method || 'Blood',
      fasting_required:
        it.fasting_required_snapshot ?? it.fasting_required ?? it.fastingRequired ?? false,
      fasting_required_snapshot:
        it.fasting_required_snapshot ?? it.fasting_required ?? it.fastingRequired ?? false,
      reporting_time:
        it.reporting_time_snapshot || it.reporting_time || it.report_time || 'Same Day',
      reporting_time_snapshot:
        it.reporting_time_snapshot || it.reporting_time || it.report_time || 'Same Day',
      created_at: it.created_at || now,
    }));
    const itemsRes = await upsertRecordsToWorksheet('Booking_Items', mappedItems, token);
    itemsSyncedCount = itemsRes.syncedCount;
  }

  // Also sync Home_Collection if collectionType is Home Collection
  const colType = String(
    bookingRecord.collection_type || bookingRecord.collectionType || bookingRecord.booking_type || ''
  ).toUpperCase();
  if (colType.includes('HOME') && bookingId) {
    const now = bookingRecord.updated_at || bookingRecord.created_at || new Date().toISOString();
    await upsertRecordsToWorksheet(
      'Home_Collection',
      [
        {
          id: `HC-${bookingId}`,
          collection_id: `HC-${bookingId}`,
          booking_id: bookingId,
          user_id: userId,
          patient_id: patientId,
          patient_name:
            bookingRecord.patient_name ||
            bookingRecord.patient_name_snapshot ||
            bookingRecord.patient?.fullName ||
            '',
          mobile_number:
            bookingRecord.mobile_number ||
            bookingRecord.phone ||
            bookingRecord.patient_phone_snapshot ||
            bookingRecord.patient?.phone ||
            '',
          phone:
            bookingRecord.mobile_number ||
            bookingRecord.phone ||
            bookingRecord.patient_phone_snapshot ||
            bookingRecord.patient?.phone ||
            '',
          address: bookingRecord.home_address || bookingRecord.address || '',
          landmark: bookingRecord.area || bookingRecord.landmark || '',
          city: bookingRecord.city || 'Jaipur',
          pincode: bookingRecord.pincode || '',
          preferred_date: bookingRecord.booking_date || bookingRecord.preferred_date || '',
          preferred_time:
            bookingRecord.time_slot || bookingRecord.preferred_time || bookingRecord.booking_time || '',
          selected_tests: items
            .map((it: any) => it.test_name_snapshot || it.test_name || it.name || it.test_id)
            .filter(Boolean)
            .join(', '),
          status: bookingRecord.status || 'CONFIRMED',
          created_at: bookingRecord.created_at || now,
          updated_at: now,
        },
      ],
      token
    );
  }

  return {
    ...bookingResult,
    itemsSyncedCount,
  };
}

export async function createPatientRow(patient: Record<string, any>, token?: string) {
  return upsertRecordsToWorksheet('Patients', [patient], token);
}

export async function updatePatientRow(patient: Record<string, any>, token?: string) {
  return upsertRecordsToWorksheet('Patients', [patient], token);
}

export async function createReportMetadataRow(report: Record<string, any>, token?: string) {
  return upsertRecordsToWorksheet('Reports', [report], token);
}

export async function createContactEnquiryRow(enquiry: Record<string, any>, token?: string) {
  return upsertRecordsToWorksheet('Contact_Enquiries', [enquiry], token);
}

export async function createLeadRow(lead: Record<string, any>, token?: string) {
  return upsertRecordsToWorksheet('Leads', [lead], token);
}

export async function createAuditLogRow(audit: Record<string, any>, token?: string) {
  return upsertRecordsToWorksheet('Audit_Logs', [audit], token);
}

export async function createSyncLogRow(syncEntry: Record<string, any>, token?: string) {
  return upsertRecordsToWorksheet('Sync_Log', [syncEntry], token);
}

export async function syncTests(tests: Record<string, any>[], token?: string) {
  return upsertRecordsToWorksheet('Tests', tests, token);
}

export async function syncPackages(packages: Record<string, any>[], token?: string) {
  return upsertRecordsToWorksheet('Packages', packages, token);
}

export async function logSync(syncEntry: Record<string, any>, token?: string) {
  return upsertRecordsToWorksheet('Sync_Log', [syncEntry], token);
}

/**
 * Fetch all rows from a Google Sheet tab and convert them into key-value objects using Row 1 headers.
 */
export async function fetchWorksheetObjects(
  tab: WorksheetTabName,
  overrideToken?: string
): Promise<Record<string, any>[]> {
  const spreadsheetId = getSpreadsheetId();
  if (!spreadsheetId) {
    throw new Error(
      'Google Sheets spreadsheet ID is not configured. Connect Google Sheets in /admin/google-sheets or set GOOGLE_SHEETS_SPREADSHEET_ID in .env.'
    );
  }

  const token = await getGoogleSheetsAccessToken(overrideToken);

  const res = await fetch(
    `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(`${tab}!A1:Z2000`)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Failed to fetch rows from ${tab} (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as { values?: string[][] };
  const rows = data.values || [];
  if (rows.length <= 1) return [];

  const headers = rows[0].map((h) => String(h).trim());
  const objects: Record<string, any>[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((cell) => !String(cell || '').trim())) continue;
    const obj: Record<string, any> = {};
    headers.forEach((h, colIdx) => {
      if (h) {
        obj[h] = row[colIdx] !== undefined ? row[colIdx] : '';
      }
    });
    objects.push(obj);
  }

  return objects;
}
