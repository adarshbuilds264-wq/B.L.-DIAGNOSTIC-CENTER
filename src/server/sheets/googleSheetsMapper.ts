/**
 * Google Sheets Schema & Entity Mapper (`googleSheetsMapper`)
 *
 * Maps primary database records (PostgreSQL / Firestore) to the official worksheets in:
 * "B.L. Diagnostic Center - Website Database"
 *
 * SECURITY RULE FOR REPORTS & CREDENTIALS:
 * - Never maps or uploads raw report binary files or base64 payloads into Google Sheets.
 * - Only maps `File Reference` (`private://reports/...`) and non-sensitive metadata.
 * - Never maps passwords, authentication tokens, or private keys.
 */

export type WorksheetTabName =
  | 'Users'
  | 'Patients'
  | 'Bookings'
  | 'Booking_Items'
  | 'Tests'
  | 'Packages'
  | 'Reports'
  | 'Home_Collection'
  | 'Contact_Enquiries'
  | 'Leads'
  | 'Notifications'
  | 'Analytics'
  | 'Audit_Logs'
  | 'Sync_Log'
  | 'Test_Categories'
  | 'Package_Items';

export const WORKSHEET_TABS: WorksheetTabName[] = [
  'Users',
  'Patients',
  'Bookings',
  'Booking_Items',
  'Tests',
  'Packages',
  'Reports',
  'Home_Collection',
  'Contact_Enquiries',
  'Leads',
  'Notifications',
  'Analytics',
  'Audit_Logs',
  'Sync_Log',
  'Test_Categories',
  'Package_Items',
];

export const WORKSHEET_HEADERS: Record<WorksheetTabName, string[]> = {
  Users: [
    'User ID',
    'Name',
    'Mobile Number',
    'Mobile Verified',
    'Role',
    'Status',
    'Registration Date',
    'Last Login',
    'Created At',
    'Updated At',
  ],
  Patients: [
    'Patient ID',
    'User ID',
    'Patient Name',
    'Relationship',
    'Gender',
    'Date of Birth',
    'Mobile Number',
    'Address',
    'City',
    'Pincode',
    'Created At',
    'Updated At',
  ],
  Bookings: [
    'Booking ID',
    'User ID',
    'Patient ID',
    'Patient Name',
    'Mobile Number',
    'Booking Type',
    'Selected Tests',
    'Total Amount',
    'Preferred Date',
    'Preferred Time Slot',
    'Booking Status',
    'Payment Status',
    'Collection Type',
    'Address',
    'City',
    'Pincode',
    'Notes',
    'Created At',
    'Updated At',
  ],
  Booking_Items: [
    'Item ID',
    'Booking ID',
    'User ID',
    'Patient ID',
    'Test ID',
    'Test Name',
    'Category',
    'Price',
    'Sample Type',
    'Fasting Required',
    'Report Time',
    'Created At',
  ],
  Tests: [
    'Test ID',
    'Test Name',
    'Category',
    'Method',
    'Sample',
    'Sample Instructions',
    'Clinical Information',
    'Reporting Time',
    'General Price',
    'Corporate Price',
    'Active',
    'Created At',
    'Updated At',
  ],
  Packages: [
    'Package ID',
    'Package Name',
    'Description',
    'Included Tests',
    'Price',
    'Status',
    'Created At',
    'Updated At',
  ],
  Reports: [
    'Report ID',
    'Booking ID',
    'Patient ID',
    'User ID',
    'Report Name',
    'Report Date',
    'Status',
    'File Reference',
    'Created At',
    'Updated At',
  ],
  Home_Collection: [
    'Collection ID',
    'Booking ID',
    'Patient Name',
    'Mobile Number',
    'Address',
    'Landmark',
    'City',
    'Pincode',
    'Preferred Date',
    'Preferred Time',
    'Selected Tests',
    'Status',
    'Created At',
  ],
  Contact_Enquiries: [
    'Enquiry ID',
    'Name',
    'Mobile Number',
    'Email (optional)',
    'Message',
    'Status',
    'Created At',
  ],
  Leads: [
    'Lead ID',
    'Name',
    'Mobile Number',
    'Email (optional)',
    'Message',
    'Source',
    'Status',
    'Created At',
    'Updated At',
  ],
  Notifications: [
    'Notification ID',
    'User ID',
    'Type',
    'Title',
    'Message',
    'Read Status',
    'Created At',
  ],
  Analytics: [
    'Metric ID',
    'Metric Date',
    'Metric Group',
    'Metric Key',
    'Metric Value',
    'Notes',
    'Updated At',
  ],
  Audit_Logs: [
    'Log ID',
    'User ID',
    'Admin ID',
    'Action',
    'Entity Type',
    'Entity ID',
    'Description',
    'Created At',
  ],
  Sync_Log: [
    'Sync ID',
    'Entity Type',
    'Entity ID',
    'Operation',
    'Status',
    'Attempt Count',
    'Error Message',
    'Last Attempt At',
    'Created At',
    'Updated At',
  ],
  Test_Categories: [
    'Category ID',
    'Category Name',
    'Description',
    'Total Tests',
    'Active Tests',
    'Status',
    'Updated At',
  ],
  Package_Items: [
    'Package Item ID',
    'Package ID',
    'Test ID',
    'Test Name',
    'Category',
    'Created At',
  ],
};

function cleanCell(val: unknown): string | number {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') return val;
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  const str = String(val).trim();
  // Prevent CSV/Sheet formula injection (=, +, -, @)
  if (/^[=+\-@]/.test(str) && isNaN(Number(str))) {
    return `'${str}`;
  }
  return str;
}

/**
 * Generates a deterministic formatted User ID (`USR-000001` or `USR-xxxxxx`) if one is not already assigned.
 */
export function formatUserSheetId(record: Record<string, any>): string {
  const existingId = String(record.userId || record.user_id || '').trim();
  if (existingId.startsWith('USR-')) {
    return existingId;
  }
  if (existingId.startsWith('USER-')) {
    return existingId.replace(/^USER-/, 'USR-');
  }
  const phoneDigits = String(record.mobile_number || record.phone || '').replace(/\D/g, '');
  if (phoneDigits.length >= 10) {
    return `USR-${phoneDigits.slice(-6)}`;
  }
  const rawUid = String(record.uid || record.firebase_uid || record.id || '');
  if (!rawUid) return 'USR-000001';
  if (rawUid.startsWith('USR-')) return rawUid;
  let hash = 0;
  for (let i = 0; i < rawUid.length; i++) {
    hash = (hash * 31 + rawUid.charCodeAt(i)) % 900000;
  }
  const num = String(Math.abs(hash) + 100000).padStart(6, '0');
  return `USR-${num}`;
}

/**
 * Maps any entity payload to its exact Google Sheets row array based on the target worksheet tab.
 */
export function mapEntityToSheetRow(tab: WorksheetTabName, record: Record<string, any>): (string | number)[] {
  const now = new Date().toISOString();

  switch (tab) {
    case 'Users': {
      // Columns: User ID | Name | Mobile Number | Mobile Verified | Role | Status | Registration Date | Last Login | Created At | Updated At
      const formattedUserId = formatUserSheetId(record);
      const createdAt = record.created_at || record.createdAt || now;
      const regDate = record.registration_date || record.registrationDate || createdAt;
      const lastLogin =
        record.last_login_at ||
        record.last_login ||
        record.lastLogin ||
        record.updated_at ||
        record.updatedAt ||
        now;
      const mobileNumber = record.mobile_number || record.mobileNumber || record.phone || '';
      const isVerified =
        record.is_verified === false || record.mobile_verified === 'FALSE' ? 'FALSE' : 'TRUE';
      const status =
        record.account_status ||
        record.status ||
        (record.is_active === false || record.isActive === false ? 'DEACTIVATED' : 'ACTIVE');

      return [
        cleanCell(formattedUserId),
        cleanCell(record.name || record.full_name || record.displayName || 'Customer'),
        cleanCell(mobileNumber),
        cleanCell(isVerified),
        cleanCell(record.role || 'USER'),
        cleanCell(status),
        cleanCell(regDate),
        cleanCell(lastLogin),
        cleanCell(createdAt),
        cleanCell(record.updated_at || record.updatedAt || now),
      ];
    }

    case 'Patients':
      // Columns: Patient ID | User ID | Patient Name | Relationship | Gender | Date of Birth | Mobile Number | Address | City | Pincode | Created At | Updated At
      return [
        cleanCell(record.id || record.patient_id),
        cleanCell(record.user_id || record.userId || ''),
        cleanCell(record.patient_name || record.full_name || record.fullName || ''),
        cleanCell(record.relationship || record.relation || 'Self'),
        cleanCell(record.gender || ''),
        cleanCell(record.date_of_birth || (record.age ? `Age: ${record.age}` : '')),
        cleanCell(record.mobile_number || record.phone || ''),
        cleanCell(record.address || ''),
        cleanCell(record.city || 'Jaipur'),
        cleanCell(record.pincode || '302033'),
        cleanCell(record.created_at || record.createdAt || now),
        cleanCell(record.updated_at || record.updatedAt || now),
      ];

    case 'Bookings': {
      // Columns: Booking ID | User ID | Patient ID | Patient Name | Mobile Number | Booking Type | Selected Tests | Total Amount | Preferred Date | Preferred Time Slot | Booking Status | Payment Status | Collection Type | Address | City | Pincode | Notes | Created At | Updated At
      const bookingId = record.id || record.booking_id || record.booking_number;
      const colTypeRaw = String(
        record.collection_type || record.booking_type || record.collectionType || 'CENTER_VISIT'
      ).toUpperCase();
      const collectionType = colTypeRaw.includes('HOME') ? 'HOME_COLLECTION' : 'CENTER_VISIT';
      const itemsList = Array.isArray(record.items)
        ? record.items
        : Array.isArray(record.tests)
        ? record.tests
        : [];
      const selectedTestsStr =
        record.selected_tests ||
        (itemsList.length > 0
          ? itemsList
              .map((it: any) => it.test_name_snapshot || it.test_name || it.name || it.test_id)
              .filter(Boolean)
              .join(', ')
          : '');
      const hasPackage = itemsList.some(
        (it: any) =>
          String(it.category_snapshot || it.category || '').toLowerCase().includes('package') ||
          String(it.test_id || '').startsWith('PKG')
      );
      const bookingType =
        record.booking_category || (hasPackage ? 'HEALTH_PACKAGE' : 'DIAGNOSTIC_TEST');
      const totalAmount = Number(
        record.total_amount ??
          record.totalAmount ??
          itemsList.reduce((sum: number, it: any) => sum + Number(it.price_snapshot ?? it.price ?? 0), 0)
      );
      const userIdCell = record.user_id || record.userId || '';

      return [
        cleanCell(bookingId),
        cleanCell(userIdCell),
        cleanCell(record.patient_id || (record.patient && record.patient.id) || ''),
        cleanCell(
          record.patient_name ||
            record.patient_name_snapshot ||
            (record.patient && record.patient.fullName) ||
            ''
        ),
        cleanCell(
          record.mobile_number ||
            record.phone ||
            record.patient_phone_snapshot ||
            (record.patient && record.patient.phone) ||
            ''
        ),
        cleanCell(bookingType),
        cleanCell(selectedTestsStr),
        totalAmount,
        cleanCell(record.preferred_date || record.booking_date || record.bookingDate || ''),
        cleanCell(
          record.preferred_time_slot ||
            record.preferred_time ||
            record.booking_time ||
            record.time_slot ||
            record.timeSlot ||
            ''
        ),
        cleanCell(record.booking_status || record.status || 'CONFIRMED'),
        cleanCell(record.payment_status || record.paymentStatus || 'PAY_AT_COLLECTION'),
        cleanCell(collectionType),
        cleanCell(
          record.address ||
            record.home_address ||
            (collectionType === 'CENTER_VISIT'
              ? 'B.L. Diagnostic Center, Near Post Office, Kumbha Marg, Sector 11, Pratap Nagar'
              : '')
        ),
        cleanCell(record.city || 'Jaipur'),
        cleanCell(record.pincode || (collectionType === 'CENTER_VISIT' ? '302033' : '')),
        cleanCell(record.notes || record.internal_notes || ''),
        cleanCell(record.created_at || record.createdAt || now),
        cleanCell(record.updated_at || record.updatedAt || now),
      ];
    }

    case 'Booking_Items': {
      // Columns: Item ID | Booking ID | User ID | Patient ID | Test ID | Test Name | Category | Price | Sample Type | Fasting Required | Report Time | Created At
      const fastingVal =
        record.fasting_required ??
        record.fasting_required_snapshot ??
        record.fastingRequired ??
        false;
      const fastingStr =
        typeof fastingVal === 'boolean'
          ? fastingVal
            ? 'Yes'
            : 'No'
          : String(fastingVal || 'No');
      return [
        cleanCell(
          record.item_id ||
            record.id ||
            record.booking_item_id ||
            `${record.booking_id}_${record.test_id}`
        ),
        cleanCell(record.booking_id || ''),
        cleanCell(record.user_id || record.userId || ''),
        cleanCell(record.patient_id || record.patientId || ''),
        cleanCell(record.test_id || ''),
        cleanCell(record.test_name || record.test_name_snapshot || record.name || ''),
        cleanCell(record.category || record.category_snapshot || 'Clinical Pathology'),
        Number(record.price ?? record.price_snapshot ?? 0),
        cleanCell(
          record.sample_type ||
            record.sample_type_snapshot ||
            record.sample ||
            record.method ||
            record.method_snapshot ||
            'Blood'
        ),
        cleanCell(fastingStr),
        cleanCell(
          record.report_time ||
            record.reporting_time ||
            record.reporting_time_snapshot ||
            'Same Day'
        ),
        cleanCell(record.created_at || record.createdAt || now),
      ];
    }

    case 'Tests':
      // Columns: Test ID | Test Name | Category | Method | Sample | Sample Instructions | Clinical Information | Reporting Time | General Price | Corporate Price | Active | Created At | Updated At
      return [
        cleanCell(record.id || record.test_id),
        cleanCell(record.test_name || record.name || ''),
        cleanCell(record.category || 'Clinical Pathology'),
        cleanCell(record.method || ''),
        cleanCell(record.sample || record.sampleType || ''),
        cleanCell(record.sample_instructions || ''),
        cleanCell(record.clinical_information || record.description || ''),
        cleanCell(record.reporting_time || record.turnaroundTime || ''),
        record.general_price ?? record.price ?? '',
        record.corporate_price ?? '',
        cleanCell(record.is_active === false || record.status === 'INACTIVE' ? 'FALSE' : 'TRUE'),
        cleanCell(record.created_at || now),
        cleanCell(record.updated_at || now),
      ];

    case 'Packages': {
      const includedTests = Array.isArray(record.items)
        ? record.items.map((i: any) => i.test_name || i.test_id).filter(Boolean).join(', ')
        : record.included_tests || '';
      return [
        cleanCell(record.id || record.package_id),
        cleanCell(record.package_name || record.name || ''),
        cleanCell(record.description || ''),
        cleanCell(includedTests),
        Number(record.price ?? 0),
        cleanCell(record.status || (record.is_active === false ? 'INACTIVE' : 'ACTIVE')),
        cleanCell(record.created_at || now),
        cleanCell(record.updated_at || now),
      ];
    }

    case 'Reports':
      return [
        cleanCell(record.id || record.report_id),
        cleanCell(record.booking_id || ''),
        cleanCell(record.patient_id || ''),
        cleanCell(record.user_id || ''),
        cleanCell(record.report_name || record.report_title || record.file_name || ''),
        cleanCell(record.report_date || record.uploaded_at || now),
        cleanCell(record.status || (record.is_active === false ? 'ARCHIVED' : 'ACTIVE')),
        cleanCell(record.file_reference || `private://reports/${record.id || record.report_id}`),
        cleanCell(record.created_at || record.uploaded_at || now),
        cleanCell(record.updated_at || now),
      ];

    case 'Home_Collection': {
      // Columns: Collection ID | Booking ID | Patient Name | Mobile Number | Address | Landmark | City | Pincode | Preferred Date | Preferred Time | Selected Tests | Status | Created At
      const selectedTestsStr = Array.isArray(record.selected_tests)
        ? record.selected_tests.join(', ')
        : Array.isArray(record.items)
        ? record.items
            .map((it: any) => it.test_name_snapshot || it.test_name || it.test_id)
            .filter(Boolean)
            .join(', ')
        : String(record.selected_tests || '');

      return [
        cleanCell(record.collection_id || record.id || `HC-${record.booking_id}`),
        cleanCell(record.booking_id || ''),
        cleanCell(record.patient_name || record.patient_name_snapshot || ''),
        cleanCell(record.mobile_number || record.phone || record.patient_phone_snapshot || ''),
        cleanCell(record.address || record.home_address || ''),
        cleanCell(record.landmark || record.area || ''),
        cleanCell(record.city || 'Jaipur'),
        cleanCell(record.pincode || ''),
        cleanCell(record.preferred_date || record.booking_date || ''),
        cleanCell(record.preferred_time || record.time_slot || record.booking_time || ''),
        cleanCell(selectedTestsStr),
        cleanCell(record.status || 'PENDING'),
        cleanCell(record.created_at || now),
      ];
    }

    case 'Contact_Enquiries':
      // Columns: Enquiry ID | Name | Mobile Number | Email (optional) | Message | Status | Created At
      return [
        cleanCell(record.id || record.enquiry_id),
        cleanCell(record.name || ''),
        cleanCell(record.mobile_number || record.phone || ''),
        cleanCell(record.email || ''),
        cleanCell(record.message || ''),
        cleanCell(record.status || 'NEW'),
        cleanCell(record.created_at || record.createdAt || now),
      ];

    case 'Leads':
      // Columns: Lead ID | Name | Mobile Number | Email (optional) | Message | Source | Status | Created At | Updated At
      return [
        cleanCell(record.id || record.lead_id),
        cleanCell(record.name || record.fullName || ''),
        cleanCell(record.mobile_number || record.phone || ''),
        cleanCell(record.email || ''),
        cleanCell(record.message || record.notes || record.serviceType || ''),
        cleanCell(record.source || 'WEBSITE'),
        cleanCell(record.status || 'NEW'),
        cleanCell(record.created_at || record.createdAt || now),
        cleanCell(record.updated_at || record.updatedAt || now),
      ];

    case 'Notifications':
      return [
        cleanCell(record.id),
        cleanCell(record.user_id || record.userId || ''),
        cleanCell(record.type || 'SYSTEM'),
        cleanCell(record.title || ''),
        cleanCell(record.message || ''),
        cleanCell(record.read_status || (record.isRead ? 'READ' : 'UNREAD')),
        cleanCell(record.created_at || record.createdAt || now),
      ];

    case 'Analytics':
      return [
        cleanCell(record.id || `${record.metric_date || now.slice(0, 10)}_${record.metric_key}`),
        cleanCell(record.metric_date || now.slice(0, 10)),
        cleanCell(record.metric_group || 'DATABASE_SUMMARY'),
        cleanCell(record.metric_key || ''),
        Number(record.metric_value ?? 0),
        cleanCell(record.notes || ''),
        cleanCell(record.updated_at || now),
      ];

    case 'Audit_Logs':
      return [
        cleanCell(record.id),
        cleanCell(record.user_id || (record.actorRole === 'USER' ? record.actorUid : '') || ''),
        cleanCell(record.admin_id || record.actor_uid || record.actorUid || record.actorEmail || ''),
        cleanCell(record.action || ''),
        cleanCell(record.entity_type || record.entityType || ''),
        cleanCell(record.entity_id || record.entityId || ''),
        cleanCell(record.description || record.details || ''),
        cleanCell(record.created_at || record.timestamp || now),
      ];

    case 'Sync_Log':
      return [
        cleanCell(record.sync_id || record.id),
        cleanCell(record.entity_type || 'Users'),
        cleanCell(record.entity_id || ''),
        cleanCell(record.operation || 'CREATE'),
        cleanCell(record.status || 'PENDING'),
        Number(record.attempt_count ?? 1),
        cleanCell(record.error_message || ''),
        cleanCell(record.last_attempt_at || now),
        cleanCell(record.created_at || now),
        cleanCell(record.updated_at || now),
      ];

    case 'Test_Categories':
      return [
        cleanCell(record.id),
        cleanCell(record.name),
        cleanCell(record.description || ''),
        Number(record.totalTests ?? record.total_tests ?? 0),
        Number(record.activeTests ?? record.active_tests ?? 0),
        cleanCell(record.status || 'ACTIVE'),
        cleanCell(record.updated_at || now),
      ];

    case 'Package_Items':
      return [
        cleanCell(record.id || record.item_id || `${record.package_id}_${record.test_id || record.test_name}`),
        cleanCell(record.package_id || ''),
        cleanCell(record.test_id || ''),
        cleanCell(record.test_name || ''),
        cleanCell(record.category || ''),
        cleanCell(record.created_at || now),
      ];
  }
}

export interface SheetImportValidationResult {
  valid: boolean;
  tab: WorksheetTabName;
  totalRows: number;
  validRecords: Record<string, any>[];
  duplicates: { id: string; row: number; reason: string }[];
  errors: { row: number; field: string; message: string }[];
}

/**
 * Validates inbound rows edited by Admin in Google Sheets before writing to PostgreSQL / Firestore.
 */
export function validateInboundSheetRows(
  tab: WorksheetTabName,
  rows: Record<string, any>[]
): SheetImportValidationResult {
  const validRecords: Record<string, any>[] = [];
  const duplicates: { id: string; row: number; reason: string }[] = [];
  const errors: { row: number; field: string; message: string }[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const now = new Date().toISOString();

  rows.forEach((raw, idx) => {
    const rowNum = idx + 2;
    if (!raw || typeof raw !== 'object') {
      errors.push({ row: rowNum, field: 'row', message: 'Empty or malformed row object' });
      return;
    }

    if (tab === 'Tests') {
      const id = String(raw.id || raw.test_id || raw['Test ID'] || '').trim();
      const testName = String(raw.test_name || raw['Test Name'] || '').trim();
      const category = String(raw.category || raw['Category'] || 'Clinical Pathology').trim();
      const genPriceRaw = raw.general_price ?? raw['General Price'];
      const corpPriceRaw = raw.corporate_price ?? raw['Corporate Price'];

      if (!id) {
        errors.push({ row: rowNum, field: 'id', message: 'Missing Test ID' });
        return;
      }
      if (!testName) {
        errors.push({ row: rowNum, field: 'test_name', message: `Missing Test Name for ID ${id}` });
        return;
      }
      if (seenIds.has(id.toUpperCase())) {
        duplicates.push({ id, row: rowNum, reason: `Duplicate Test ID "${id}" in import sheet` });
        return;
      }
      if (seenNames.has(testName.toLowerCase())) {
        duplicates.push({ id, row: rowNum, reason: `Duplicate Test Name "${testName}" in import sheet` });
      }

      const generalPrice =
        genPriceRaw !== '' && genPriceRaw !== null && genPriceRaw !== undefined && !isNaN(Number(genPriceRaw))
          ? Number(genPriceRaw)
          : null;
      const corporatePrice =
        corpPriceRaw !== '' && corpPriceRaw !== null && corpPriceRaw !== undefined && !isNaN(Number(corpPriceRaw))
          ? Number(corpPriceRaw)
          : null;

      if (generalPrice !== null && generalPrice < 0) {
        errors.push({ row: rowNum, field: 'general_price', message: `Negative General Price (${generalPrice}) not allowed` });
        return;
      }
      if (corporatePrice !== null && corporatePrice < 0) {
        errors.push({ row: rowNum, field: 'corporate_price', message: `Negative Corporate Price (${corporatePrice}) not allowed` });
        return;
      }

      seenIds.add(id.toUpperCase());
      seenNames.add(testName.toLowerCase());

      const statusStr = String(raw.status || raw['Status'] || 'ACTIVE').toUpperCase();
      validRecords.push({
        test_id: id,
        test_name: testName,
        category,
        method: raw.method || raw['Method'] ? String(raw.method || raw['Method']).trim() : null,
        sample: raw.sample || raw['Sample'] ? String(raw.sample || raw['Sample']).trim() : null,
        sample_instructions:
          raw.sample_instructions || raw['Sample Instructions'] || raw['Instructions']
            ? String(raw.sample_instructions || raw['Sample Instructions'] || raw['Instructions']).trim()
            : null,
        clinical_information:
          raw.clinical_information || raw['Clinical Information']
            ? String(raw.clinical_information || raw['Clinical Information']).trim()
            : null,
        reporting_time:
          raw.reporting_time || raw['Reporting Time']
            ? String(raw.reporting_time || raw['Reporting Time']).trim()
            : 'Same Day',
        general_price: generalPrice,
        corporate_price: corporatePrice,
        is_active: statusStr !== 'INACTIVE' && statusStr !== 'FALSE',
        updated_at: now,
      });
      return;
    }

    if (tab === 'Packages') {
      const id = String(raw.id || raw.package_id || raw['Package ID'] || '').trim();
      const packageName = String(raw.package_name || raw['Package Name'] || '').trim();
      const price = Number(raw.price ?? raw['Price']);

      if (!id || !packageName) {
        errors.push({ row: rowNum, field: 'package_name', message: 'Missing Package ID or Package Name' });
        return;
      }
      if (isNaN(price) || price < 0) {
        errors.push({ row: rowNum, field: 'price', message: `Invalid package price for ${packageName}` });
        return;
      }
      if (seenIds.has(id.toUpperCase())) {
        duplicates.push({ id, row: rowNum, reason: `Duplicate Package ID "${id}"` });
        return;
      }
      seenIds.add(id.toUpperCase());

      const statusStr = String(raw.status || raw['Status'] || 'ACTIVE').toUpperCase();
      validRecords.push({
        package_id: id,
        package_name: packageName,
        description: raw.description || raw['Description'] ? String(raw.description || raw['Description']).trim() : null,
        price,
        is_active: statusStr !== 'INACTIVE' && statusStr !== 'FALSE',
        updated_at: now,
      });
      return;
    }

    if (tab === 'Bookings') {
      const id = String(raw.id || raw.booking_number || raw['Booking ID'] || '').trim();
      const status = String(raw.status || raw['Status'] || '').trim().toUpperCase();
      const allowedStatuses = [
        'PENDING',
        'CONFIRMED',
        'COLLECTION_ASSIGNED',
        'SAMPLE_COLLECTED',
        'COMPLETED',
        'CANCELLED',
      ];
      if (!id) {
        errors.push({ row: rowNum, field: 'id', message: 'Missing Booking ID' });
        return;
      }
      if (!allowedStatuses.includes(status)) {
        errors.push({
          row: rowNum,
          field: 'status',
          message: `Invalid booking status "${status}". Allowed: ${allowedStatuses.join(', ')}`,
        });
        return;
      }
      if (seenIds.has(id)) {
        duplicates.push({ id, row: rowNum, reason: `Duplicate Booking ID "${id}"` });
        return;
      }
      seenIds.add(id);
      validRecords.push({
        booking_id: id,
        status,
        updated_at: now,
      });
      return;
    }

    const id = String(raw.id || raw.sync_id || raw['User ID'] || raw['Patient ID'] || raw['Sync ID'] || '').trim();
    if (!id) {
      errors.push({ row: rowNum, field: 'id', message: `Missing primary key ID in ${tab}` });
      return;
    }
    if (seenIds.has(id)) {
      duplicates.push({ id, row: rowNum, reason: `Duplicate ID "${id}" in ${tab}` });
      return;
    }
    seenIds.add(id);
    validRecords.push({ ...raw, id, updated_at: now });
  });

  return {
    valid: errors.length === 0,
    tab,
    totalRows: rows.length,
    validRecords,
    duplicates,
    errors,
  };
}
