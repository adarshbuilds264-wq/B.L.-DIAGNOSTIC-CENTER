import fs from 'fs';
import path from 'path';
import { executeEntitySyncToSheets, SyncLogEntry } from '../sheets/googleSheetsSync';
import { mapEntityToSheetRow } from '../sheets/googleSheetsMapper';

/**
 * Backend Booking Persistence & Google Sheets Synchronization Service
 *
 * Implements the server-side PostgreSQL / Primary Store -> Google Sheets synchronization
 * pipeline for new appointments and their associated test items created in the booking engine:
 *   1. Persists the booking (`bookings` table) and associated items (`booking_items` table)
 *      in the primary server database store.
 *   2. Pushes the booking row to the dedicated 'Bookings' worksheet in Google Sheets.
 *   3. Pushes all associated test/package items to the dedicated 'Booking_Items' worksheet.
 *   4. If Home Collection is selected, pushes the dispatch row to 'Home_Collection'.
 *   5. Records Sync_Log entries and queues any failed/offline syncs for automatic or manual retry
 *      without ever failing or rolling back the primary database booking creation.
 */

export interface ServerBookingItemRecord {
  booking_item_id: string;
  booking_id: string;
  user_id: string;
  patient_id: string;
  test_id: string;
  test_name_snapshot: string;
  category_snapshot: string;
  price_snapshot: number;
  sample_type_snapshot: string;
  fasting_required_snapshot: boolean;
  method_snapshot: string;
  reporting_time_snapshot: string;
  created_at: string;
}

export interface ServerBookingRecord {
  booking_id: string;
  user_id: string;
  patient_id: string;
  patient_name_snapshot: string;
  patient_age_snapshot: number;
  patient_gender_snapshot: string;
  patient_phone_snapshot: string;
  collection_type: 'HOME_COLLECTION' | 'CENTER_VISIT';
  home_address?: string;
  area?: string;
  city: string;
  pincode: string;
  booking_date: string;
  time_slot: string;
  status: string;
  payment_status: string;
  notes?: string;
  items: ServerBookingItemRecord[];
  total_amount: number;
  sync_status: 'SYNCED' | 'PENDING_SYNC' | 'SYNC_FAILED';
  created_at: string;
  updated_at: string;
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const BOOKINGS_STORE_PATH = path.join(DATA_DIR, 'bookings_store.json');

const bookingsById = new Map<string, ServerBookingRecord>();
const bookingItemsByBookingId = new Map<string, ServerBookingItemRecord[]>();

function loadPersistedBookings(): void {
  try {
    if (!fs.existsSync(BOOKINGS_STORE_PATH)) return;
    const raw = fs.readFileSync(BOOKINGS_STORE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.bookings)) {
      for (const b of parsed.bookings as ServerBookingRecord[]) {
        if (b && b.booking_id) {
          bookingsById.set(b.booking_id, b);
          bookingItemsByBookingId.set(b.booking_id, Array.isArray(b.items) ? b.items : []);
        }
      }
    }
  } catch (err) {
    console.warn('[BookingSyncService] Failed to load persisted bookings:', err);
  }
}

function savePersistedBookings(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const bookings = Array.from(bookingsById.values());
    fs.writeFileSync(BOOKINGS_STORE_PATH, JSON.stringify({ bookings }, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[BookingSyncService] Failed to persist bookings:', err);
  }
}

loadPersistedBookings();

export function getAllServerBookings(): ServerBookingRecord[] {
  return Array.from(bookingsById.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export function getServerBookingById(bookingId: string): ServerBookingRecord | null {
  return bookingsById.get(bookingId) || null;
}

/**
 * Persists a newly created or updated booking and its associated items in the server primary database
 * and pushes them to the dedicated 'Bookings' and 'Booking_Items' (and 'Home_Collection') Google Sheets.
 */
export async function persistAndSyncBookingToGoogleSheets(
  rawBooking: Record<string, any>,
  options?: {
    operation?: 'CREATE' | 'UPDATE';
    bearerToken?: string;
  }
): Promise<{
  booking: ServerBookingRecord;
  bookingSyncLog: SyncLogEntry;
  bookingItemsSyncLog: SyncLogEntry | null;
  homeCollectionSyncLog: SyncLogEntry | null;
  overallSyncStatus: 'SYNCED' | 'PENDING_SYNC' | 'SYNC_FAILED';
  mappedBookingRow: (string | number)[];
  mappedItemRows: (string | number)[][];
}> {
  const now = new Date().toISOString();
  const operation = options?.operation || 'CREATE';
  const bearerToken = options?.bearerToken;

  const bookingId = String(
    rawBooking.booking_id || rawBooking.booking_number || rawBooking.id || `BL-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`
  ).trim();
  const userId = String(rawBooking.user_id || rawBooking.userId || '').trim();
  const patientId = String(
    rawBooking.patient_id || rawBooking.patientId || rawBooking.patient?.id || ''
  ).trim();

  const rawItems: any[] = Array.isArray(rawBooking.items)
    ? rawBooking.items
    : Array.isArray(rawBooking.tests)
    ? rawBooking.tests
    : [];

  const createdAt = String(rawBooking.created_at || rawBooking.createdAt || now);
  const updatedAt = String(rawBooking.updated_at || rawBooking.updatedAt || now);

  const normalizedItems: ServerBookingItemRecord[] = rawItems.map((it: any, idx: number) => ({
    booking_item_id: String(
      it.booking_item_id || it.item_id || it.id || `${bookingId}-ITEM-${idx + 1}`
    ),
    booking_id: bookingId,
    user_id: String(it.user_id || userId),
    patient_id: String(it.patient_id || patientId),
    test_id: String(it.test_id || it.id || ''),
    test_name_snapshot: String(it.test_name_snapshot || it.test_name || it.name || ''),
    category_snapshot: String(it.category_snapshot || it.category || 'Clinical Pathology'),
    price_snapshot: Number(it.price_snapshot ?? it.price ?? 0),
    sample_type_snapshot: String(
      it.sample_type_snapshot ||
        it.sample_type ||
        it.sample ||
        it.method_snapshot ||
        it.method ||
        'Blood'
    ),
    fasting_required_snapshot: Boolean(
      it.fasting_required_snapshot ?? it.fasting_required ?? it.fastingRequired ?? false
    ),
    method_snapshot: String(it.method_snapshot || it.method || ''),
    reporting_time_snapshot: String(
      it.reporting_time_snapshot || it.reporting_time || it.report_time || 'Same Day'
    ),
    created_at: String(it.created_at || createdAt),
  }));

  const calculatedTotal =
    rawBooking.total_amount !== undefined
      ? Number(rawBooking.total_amount)
      : normalizedItems.reduce((sum, item) => sum + item.price_snapshot, 0);

  const colTypeRaw = String(
    rawBooking.collection_type || rawBooking.booking_type || rawBooking.collectionType || 'CENTER_VISIT'
  ).toUpperCase();
  const collectionType: 'HOME_COLLECTION' | 'CENTER_VISIT' = colTypeRaw.includes('HOME')
    ? 'HOME_COLLECTION'
    : 'CENTER_VISIT';

  const normalizedBooking: ServerBookingRecord = {
    booking_id: bookingId,
    user_id: userId,
    patient_id: patientId,
    patient_name_snapshot: String(
      rawBooking.patient_name_snapshot ||
        rawBooking.patient_name ||
        rawBooking.patient?.fullName ||
        ''
    ),
    patient_age_snapshot: Number(
      rawBooking.patient_age_snapshot ?? rawBooking.patient?.age ?? 30
    ),
    patient_gender_snapshot: String(
      rawBooking.patient_gender_snapshot || rawBooking.patient?.gender || 'Male'
    ),
    patient_phone_snapshot: String(
      rawBooking.patient_phone_snapshot ||
        rawBooking.mobile_number ||
        rawBooking.phone ||
        rawBooking.patient?.phone ||
        ''
    ),
    collection_type: collectionType,
    home_address:
      rawBooking.home_address ||
      rawBooking.address ||
      (collectionType === 'CENTER_VISIT'
        ? 'B.L. Diagnostic Center, Near Post Office, Kumbha Marg, Sector 11, Pratap Nagar'
        : ''),
    area: rawBooking.area || '',
    city: String(rawBooking.city || 'Jaipur'),
    pincode: String(
      rawBooking.pincode || (collectionType === 'CENTER_VISIT' ? '302033' : '')
    ),
    booking_date: String(rawBooking.booking_date || rawBooking.preferred_date || ''),
    time_slot: String(
      rawBooking.time_slot ||
        rawBooking.preferred_time_slot ||
        rawBooking.preferred_time ||
        rawBooking.booking_time ||
        ''
    ),
    status: String(rawBooking.status || rawBooking.booking_status || 'CONFIRMED'),
    payment_status: String(rawBooking.payment_status || 'PAY_AT_COLLECTION'),
    notes: rawBooking.notes ? String(rawBooking.notes) : undefined,
    items: normalizedItems,
    total_amount: calculatedTotal,
    sync_status: 'PENDING_SYNC',
    created_at: createdAt,
    updated_at: updatedAt,
  };

  // 1. Save to Primary Server Database Store First (PostgreSQL / Primary DB Source of Truth)
  bookingsById.set(bookingId, normalizedBooking);
  bookingItemsByBookingId.set(bookingId, normalizedItems);
  savePersistedBookings();

  // 2. Push Booking to the dedicated 'Bookings' Google Sheet
  const bookingSheetPayload = {
    id: bookingId,
    booking_id: bookingId,
    booking_number: bookingId,
    user_id: normalizedBooking.user_id,
    patient_id: normalizedBooking.patient_id,
    patient_name: normalizedBooking.patient_name_snapshot,
    patient_name_snapshot: normalizedBooking.patient_name_snapshot,
    mobile_number: normalizedBooking.patient_phone_snapshot,
    phone: normalizedBooking.patient_phone_snapshot,
    collection_type: normalizedBooking.collection_type,
    selected_tests: normalizedItems.map((i) => i.test_name_snapshot).join(', '),
    total_amount: normalizedBooking.total_amount,
    booking_date: normalizedBooking.booking_date,
    preferred_date: normalizedBooking.booking_date,
    time_slot: normalizedBooking.time_slot,
    preferred_time_slot: normalizedBooking.time_slot,
    status: normalizedBooking.status,
    booking_status: normalizedBooking.status,
    payment_status: normalizedBooking.payment_status,
    address:
      normalizedBooking.collection_type === 'HOME_COLLECTION'
        ? `${normalizedBooking.home_address || ''}${
            normalizedBooking.area ? `, ${normalizedBooking.area}` : ''
          }`.trim()
        : 'B.L. Diagnostic Center, Near Post Office, Kumbha Marg, Sector 11, Pratap Nagar',
    city: normalizedBooking.city,
    pincode: normalizedBooking.pincode,
    notes: normalizedBooking.notes || '',
    items: normalizedItems,
    created_at: normalizedBooking.created_at,
    updated_at: normalizedBooking.updated_at,
  };

  const bookingSyncRes = await executeEntitySyncToSheets({
    entityType: 'Bookings',
    entityId: bookingId,
    operation,
    records: [bookingSheetPayload],
    bearerToken,
  });

  // 3. Push Associated Booking Items to the dedicated 'Booking_Items' Google Sheet
  let bookingItemsSyncLog: SyncLogEntry | null = null;
  const itemSheetPayloads = normalizedItems.map((it) => ({
    id: it.booking_item_id,
    item_id: it.booking_item_id,
    booking_item_id: it.booking_item_id,
    booking_id: bookingId,
    user_id: it.user_id,
    patient_id: it.patient_id,
    test_id: it.test_id,
    test_name: it.test_name_snapshot,
    test_name_snapshot: it.test_name_snapshot,
    category: it.category_snapshot,
    category_snapshot: it.category_snapshot,
    price: it.price_snapshot,
    price_snapshot: it.price_snapshot,
    sample_type: it.sample_type_snapshot,
    sample_type_snapshot: it.sample_type_snapshot,
    fasting_required: it.fasting_required_snapshot,
    fasting_required_snapshot: it.fasting_required_snapshot,
    reporting_time: it.reporting_time_snapshot,
    reporting_time_snapshot: it.reporting_time_snapshot,
    created_at: it.created_at,
  }));

  if (itemSheetPayloads.length > 0) {
    const itemsSyncRes = await executeEntitySyncToSheets({
      entityType: 'Booking_Items',
      entityId: `${bookingId}-ITEMS`,
      operation,
      records: itemSheetPayloads,
      bearerToken,
    });
    bookingItemsSyncLog = itemsSyncRes.syncLog;
  }

  // 4. Push Home Collection row if applicable
  let homeCollectionSyncLog: SyncLogEntry | null = null;
  if (normalizedBooking.collection_type === 'HOME_COLLECTION') {
    const hcPayload = {
      id: `HC-${bookingId}`,
      collection_id: `HC-${bookingId}`,
      booking_id: bookingId,
      user_id: normalizedBooking.user_id,
      patient_id: normalizedBooking.patient_id,
      patient_name: normalizedBooking.patient_name_snapshot,
      mobile_number: normalizedBooking.patient_phone_snapshot,
      phone: normalizedBooking.patient_phone_snapshot,
      address: normalizedBooking.home_address || '',
      landmark: normalizedBooking.area || '',
      city: normalizedBooking.city,
      pincode: normalizedBooking.pincode,
      preferred_date: normalizedBooking.booking_date,
      preferred_time: normalizedBooking.time_slot,
      selected_tests: normalizedItems.map((i) => i.test_name_snapshot).join(', '),
      status: normalizedBooking.status,
      created_at: normalizedBooking.created_at,
      updated_at: normalizedBooking.updated_at,
    };

    const hcSyncRes = await executeEntitySyncToSheets({
      entityType: 'Home_Collection',
      entityId: `HC-${bookingId}`,
      operation,
      records: [hcPayload],
      bearerToken,
    });
    homeCollectionSyncLog = hcSyncRes.syncLog;
  }

  const allSucceeded =
    bookingSyncRes.syncLog.status === 'SUCCESS' &&
    (!bookingItemsSyncLog || bookingItemsSyncLog.status === 'SUCCESS');

  const overallSyncStatus: 'SYNCED' | 'PENDING_SYNC' | 'SYNC_FAILED' = allSucceeded
    ? 'SYNCED'
    : bookingSyncRes.syncLog.status === 'FAILED' ||
      bookingItemsSyncLog?.status === 'FAILED'
    ? 'SYNC_FAILED'
    : 'PENDING_SYNC';

  normalizedBooking.sync_status = overallSyncStatus;
  bookingsById.set(bookingId, normalizedBooking);
  savePersistedBookings();

  return {
    booking: normalizedBooking,
    bookingSyncLog: bookingSyncRes.syncLog,
    bookingItemsSyncLog,
    homeCollectionSyncLog,
    overallSyncStatus,
    mappedBookingRow: mapEntityToSheetRow('Bookings', bookingSheetPayload),
    mappedItemRows: itemSheetPayloads.map((item) =>
      mapEntityToSheetRow('Booking_Items', item)
    ),
  };
}
