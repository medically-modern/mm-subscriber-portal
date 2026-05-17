const { SUBSCRIPTION_BOARD_ID, COLUMNS, PATIENT_COLUMNS } = require("./config");

const MONDAY_TOKEN = process.env.MONDAY_TOKEN;
const API_URL = "https://api.monday.com/v2";

// ─── Input validation ───

function validateNumericId(id, label = "ID") {
  const str = String(id);
  if (!/^\d+$/.test(str)) throw new Error(`Invalid ${label}: must be numeric, got "${str}"`);
  return str;
}

function validateColumnId(id) {
  const str = String(id);
  if (!/^[a-z0-9_]+$/.test(str)) throw new Error(`Invalid column ID: got "${str}"`);
  return str;
}

// ─── Monday GraphQL client ───

async function mondayQuery(query, variables = {}) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: MONDAY_TOKEN,
      "API-Version": "2024-10",
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors) {
    throw new Error(`Monday API error: ${JSON.stringify(data.errors)}`);
  }
  return data.data;
}

// ─── Find patient by phone on subscription board ───

async function findPatientByPhone(phone) {
  const digits = phone.replace(/\D/g, "");
  const safeBoard = validateNumericId(SUBSCRIPTION_BOARD_ID, "board ID");
  const safePhoneCol = validateColumnId(COLUMNS.PHONE);

  const data = await mondayQuery(`{
    items_page_by_column_values(
      board_id: ${safeBoard},
      limit: 10,
      columns: [{column_id: "${safePhoneCol}", column_values: ["${digits}"]}]
    ) {
      items {
        id name group { id title }
        column_values(ids: ["${safePhoneCol}", "${validateColumnId(COLUMNS.PATIENT_UID)}"]) {
          id text value
        }
      }
    }
  }`);

  const items = data.items_page_by_column_values?.items || [];
  if (items.length === 0) return null;

  const match = items.find((item) => {
    const uidCol = item.column_values.find((c) => c.id === COLUMNS.PATIENT_UID);
    return uidCol?.text;
  }) || items[0];

  const uidCol = match.column_values.find((c) => c.id === COLUMNS.PATIENT_UID);
  const phoneCol = match.column_values.find((c) => c.id === COLUMNS.PHONE);

  return {
    itemId: match.id,
    name: match.name,
    uid: uidCol?.text || null,
    phone: phoneCol?.text || digits,
    group: match.group,
  };
}

// ─── Find patient by UID on subscription board ───

async function findPatientByUid(uid) {
  const safeBoard = validateNumericId(SUBSCRIPTION_BOARD_ID, "board ID");
  const safeCol = validateColumnId(COLUMNS.PATIENT_UID);

  const data = await mondayQuery(`{
    items_page_by_column_values(
      board_id: ${safeBoard},
      limit: 1,
      columns: [{column_id: "${safeCol}", column_values: ["${uid.replace(/"/g, "")}"]}]
    ) {
      items {
        id name group { id title }
        column_values { id type text value }
      }
    }
  }`);

  return data.items_page_by_column_values?.items?.[0] || null;
}

// ─── Get full patient data (parsed into portal-friendly shape) ───

async function getPatientData(uid) {
  const item = await findPatientByUid(uid);
  if (!item) return null;

  const col = (id) => {
    const c = item.column_values.find((cv) => cv.id === id);
    return c?.text || "";
  };

  const colValue = (id) => {
    const c = item.column_values.find((cv) => cv.id === id);
    try { return c?.value ? JSON.parse(c.value) : null; } catch { return null; }
  };

  return {
    itemId: item.id,
    name: item.name,
    group: item.group?.title || "",

    // Subscription core
    status: col(COLUMNS.STATUS),
    daysToOrder: col(COLUMNS.DAYS_TO_ORDER),
    orderingCycle: col(COLUMNS.ORDERING_CYCLE),
    nextOrder: col(COLUMNS.NEXT_ORDER),
    subscription: col(COLUMNS.SUBSCRIPTION),
    orderType: col(COLUMNS.ORDER_TYPE),

    // Demographics
    dob: col(COLUMNS.DOB),
    gender: col(COLUMNS.GENDER),
    phone: col(COLUMNS.PHONE),
    email: col(COLUMNS.EMAIL),
    address: col(COLUMNS.ADDRESS),

    // Insurance
    primaryInsurance: col(COLUMNS.PRIMARY_INS),
    memberId1: col(COLUMNS.MEMBER_ID_1),
    secondaryInsurance: col(COLUMNS.SECONDARY_INS),
    memberId2: col(COLUMNS.MEMBER_ID_2),

    // Medical necessity
    cgmCoverage: col(COLUMNS.CGM_COVERAGE),
    mrStatus: col(COLUMNS.MR_STATUS),
    mnExpiry: col(COLUMNS.MN_EXPIRY),
    diagnosis: col(COLUMNS.DIAGNOSIS),

    // Sensors auth
    sensorsAuth: col(COLUMNS.SENSORS_AUTH),
    sensorsAuthId: col(COLUMNS.SENSORS_AUTH_ID),
    sensorsUnits: col(COLUMNS.SENSORS_UNITS),
    sensorsStart: col(COLUMNS.SENSORS_START),
    sensorsEnd: col(COLUMNS.SENSORS_END),

    // Supplies auth
    suppliesAuth: col(COLUMNS.SUPPLIES_AUTH),
    infusionAuthId: col(COLUMNS.INFUSION_AUTH_ID),
    cartridgeAuthId: col(COLUMNS.CARTRIDGE_AUTH_ID),
    suppliesUnits: col(COLUMNS.SUPPLIES_UNITS),
    suppliesStart: col(COLUMNS.SUPPLIES_START),
    suppliesEnd: col(COLUMNS.SUPPLIES_END),

    // Order details
    sensorsType: col(COLUMNS.SENSORS_TYPE),
    suppliesType: col(COLUMNS.SUPPLIES_TYPE),
    infusionSet1: col(COLUMNS.INFUSION_SET_1),
    infQty1: col(COLUMNS.INF_QTY_1),
    infusionSet2: col(COLUMNS.INFUSION_SET_2),
    infQty2: col(COLUMNS.INF_QTY_2),

    // Doctor
    doctorName: col(COLUMNS.DOCTOR_NAME),
    doctorAddress: col(COLUMNS.DOCTOR_ADDRESS),
    doctorPhone: col(COLUMNS.DOCTOR_PHONE),
    doctorFax: col(COLUMNS.DOCTOR_FAX),

    // Portal notes
    portalNotes: col(COLUMNS.PORTAL_NOTES),
  };
}

// ─── Create subitem for patient request ───

async function createPatientRequest(parentItemId, requestType, details) {
  const safeParent = validateNumericId(parentItemId, "parent item ID");
  const safeName = `[Portal] ${requestType}`.replace(/"/g, '\\"');
  const safeDetails = (details || "").replace(/"/g, '\\"');

  const data = await mondayQuery(`
    mutation {
      create_subitem(
        parent_item_id: ${safeParent},
        item_name: "${safeName}",
        column_values: "{}"
      ) {
        id name
      }
    }
  `);

  if (data.create_subitem?.id) {
    const subitemId = validateNumericId(data.create_subitem.id, "subitem ID");
    await mondayQuery(`
      mutation {
        create_update(
          item_id: ${subitemId},
          body: "${safeDetails}"
        ) {
          id
        }
      }
    `);
  }

  return data.create_subitem;
}

// ═══════════════════════════════════════════════════════
// UPDATE PATIENT FIELDS IN MONDAY
// Per-field writes — matches command-center pattern exactly.
// Status columns use {index} writes so we NEVER create new labels.
// Each field writes independently — failures don't block other fields.
// ═══════════════════════════════════════════════════════

// Field definitions: portal name → Monday column ID + write type
const FIELD_TO_COLUMN = {
  name:              { col: null, type: "name", label: "Name" },
  dob:               { col: COLUMNS.DOB, type: "text", label: "Date of Birth" },
  gender:            { col: COLUMNS.GENDER, type: "status", label: "Gender" },
  address:           { col: COLUMNS.ADDRESS, type: "location", label: "Address" },
  phone:             { col: COLUMNS.PHONE, type: "phone", label: "Phone" },
  email:             { col: COLUMNS.EMAIL, type: "email", label: "Email" },
  primaryInsurance:  { col: COLUMNS.PRIMARY_INS, type: "status", label: "Primary Insurance" },
  memberId1:         { col: COLUMNS.MEMBER_ID_1, type: "text", label: "Member ID 1" },
  secondaryInsurance:{ col: COLUMNS.SECONDARY_INS, type: "status", label: "Secondary Insurance" },
  memberId2:         { col: COLUMNS.MEMBER_ID_2, type: "text", label: "Member ID 2" },
  doctorName:        { col: COLUMNS.DOCTOR_NAME, type: "text", label: "Doctor Name" },
  doctorAddress:     { col: COLUMNS.DOCTOR_ADDRESS, type: "location", label: "Doctor Address" },
  doctorPhone:       { col: COLUMNS.DOCTOR_PHONE, type: "phone", label: "Doctor Phone" },
  sensorsType:       { col: COLUMNS.SENSORS_TYPE, type: "status", label: "Sensors Type" },
  suppliesType:      { col: COLUMNS.SUPPLIES_TYPE, type: "status", label: "Supplies Type" },
  infusionSet1:      { col: COLUMNS.INFUSION_SET_1, type: "status", label: "Infusion Set 1" },
  infQty1:           { col: COLUMNS.INF_QTY_1, type: "numeric", label: "Infusion Qty 1" },
  infusionSet2:      { col: COLUMNS.INFUSION_SET_2, type: "status", label: "Infusion Set 2" },
  infQty2:           { col: COLUMNS.INF_QTY_2, type: "numeric", label: "Infusion Qty 2" },
};

function isBlank(v) {
  return !v || v === "—" || v.trim() === "";
}

// ─── Per-column write helpers ───

const WRITE_MUTATION = `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
  change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
}`;

async function writeText(itemId, columnId, text) {
  await mondayQuery(WRITE_MUTATION, {
    boardId: SUBSCRIPTION_BOARD_ID, itemId, columnId, value: JSON.stringify(text),
  });
}

async function writeStatusIndex(itemId, columnId, index) {
  await mondayQuery(WRITE_MUTATION, {
    boardId: SUBSCRIPTION_BOARD_ID, itemId, columnId, value: JSON.stringify({ index }),
  });
}

async function writePhone(itemId, columnId, rawPhone) {
  const digits = rawPhone.replace(/\D/g, "");
  if (!digits) throw new Error("Empty phone number");
  await mondayQuery(WRITE_MUTATION, {
    boardId: SUBSCRIPTION_BOARD_ID, itemId, columnId,
    value: JSON.stringify({ phone: digits, countryShortName: "US" }),
  });
}

async function writeEmail(itemId, columnId, email) {
  await mondayQuery(WRITE_MUTATION, {
    boardId: SUBSCRIPTION_BOARD_ID, itemId, columnId,
    value: JSON.stringify({ email, text: email }),
  });
}

async function writeLocation(itemId, columnId, address, lat = 0, lng = 0) {
  await mondayQuery(WRITE_MUTATION, {
    boardId: SUBSCRIPTION_BOARD_ID, itemId, columnId,
    value: JSON.stringify({ address, lat, lng }),
  });
}

async function writeNumber(itemId, columnId, num) {
  await mondayQuery(WRITE_MUTATION, {
    boardId: SUBSCRIPTION_BOARD_ID, itemId, columnId,
    value: JSON.stringify(String(parseFloat(num) || 0)),
  });
}

// ─── Status label → index resolver ───
// Fetches Monday's real column settings, builds normalized label → index lookup.
// Uses index-based writes so we NEVER create new labels.

let _statusIndexCache = null;

async function getStatusIndexMap() {
  if (_statusIndexCache) return _statusIndexCache;
  const data = await mondayQuery(`{ boards(ids: ${validateNumericId(SUBSCRIPTION_BOARD_ID)}) { columns { id type settings_str } } }`);
  const map = {};
  for (const col of data.boards[0].columns) {
    if (col.type !== "status") continue;
    try {
      const settings = JSON.parse(col.settings_str);
      if (settings.labels) {
        map[col.id] = {};
        for (const [idx, label] of Object.entries(settings.labels)) {
          if (!label) continue;
          // Normalize: collapse all Unicode/special spaces to single regular space, trim, lowercase
          const normalized = label.replace(/[\s  ]+/g, " ").trim().toLowerCase();
          // Higher indices (regular-space versions) overwrite older Unicode-space ones
          map[col.id][normalized] = parseInt(idx, 10);
        }
      }
    } catch {}
  }
  _statusIndexCache = map;
  return map;
}

function resolveStatusIndex(columnId, portalValue, indexMap) {
  if (!indexMap[columnId]) return null;
  const normalized = portalValue.replace(/[\s  ]+/g, " ").trim().toLowerCase();
  const idx = indexMap[columnId][normalized];
  return idx !== undefined ? idx : null;
}

// ─── Update patient fields — per-field writes with error collection ───

async function updatePatientData(uid, updates) {
  const item = await findPatientByUid(uid);
  if (!item) throw new Error("Patient not found");
  const itemId = validateNumericId(item.id, "item ID");

  // Load Monday status index map (cached after first call)
  const indexMap = await getStatusIndexMap();

  // Build task list — each field gets its own independent write
  const tasks = [];
  const failures = [];

  // Skip metadata fields (lat/lng are consumed by their parent location field)
  const skipFields = new Set(["addressLat", "addressLng", "doctorAddressLat", "doctorAddressLng"]);

  for (const [field, value] of Object.entries(updates)) {
    if (skipFields.has(field)) continue;
    if (isBlank(value)) continue;
    const mapping = FIELD_TO_COLUMN[field];
    if (!mapping) continue;

    // Item name — write directly, no stripping
    if (field === "name") {
      tasks.push({
        label: mapping.label,
        fn: async () => {
          await mondayQuery(`mutation { change_simple_column_value(board_id: ${validateNumericId(SUBSCRIPTION_BOARD_ID)}, item_id: ${itemId}, column_id: "name", value: ${JSON.stringify(value.trim())}) { id } }`);
        },
      });
      continue;
    }

    if (!mapping.col) continue;

    switch (mapping.type) {
      case "text":
        tasks.push({ label: mapping.label, fn: () => writeText(itemId, mapping.col, value) });
        break;
      case "numeric":
        tasks.push({ label: mapping.label, fn: () => writeNumber(itemId, mapping.col, value) });
        break;
      case "phone":
        tasks.push({ label: mapping.label, fn: () => writePhone(itemId, mapping.col, value) });
        break;
      case "email":
        tasks.push({ label: mapping.label, fn: () => writeEmail(itemId, mapping.col, value) });
        break;
      case "location": {
        // Pull lat/lng from companion fields (sent by frontend from Google Places)
        let lat = 0, lng = 0;
        if (field === "address") {
          lat = parseFloat(updates.addressLat) || 0;
          lng = parseFloat(updates.addressLng) || 0;
        } else if (field === "doctorAddress") {
          lat = parseFloat(updates.doctorAddressLat) || 0;
          lng = parseFloat(updates.doctorAddressLng) || 0;
        }
        tasks.push({ label: mapping.label, fn: () => writeLocation(itemId, mapping.col, value, lat, lng) });
        break;
      }
      case "status": {
        const idx = resolveStatusIndex(mapping.col, value, indexMap);
        if (idx === null) {
          // Value not found in Monday's labels — reject, never create new label
          failures.push(`${mapping.label}: "${value}" is not a valid option`);
          break;
        }
        tasks.push({ label: mapping.label, fn: () => writeStatusIndex(itemId, mapping.col, idx) });
        break;
      }
    }
  }

  // Execute all writes in parallel, collect individual failures
  const results = await Promise.all(
    tasks.map(async (task) => {
      try {
        await task.fn();
        return null; // success
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[monday] Write failed for ${task.label}: ${msg}`);
        return `${task.label}: ${msg}`;
      }
    })
  );

  for (const r of results) {
    if (r) failures.push(r);
  }

  const saved = tasks.length - results.filter(Boolean).length;

  if (failures.length > 0) {
    return { partial: true, saved, failures };
  }

  return { partial: false, saved: tasks.length, failures: [] };
}

// ─── Append note to Patient Portal Notes column ───

const PORTAL_NOTES_COLUMN = "long_text_mm3evvzj";

async function appendPatientNote(uid, note) {
  const item = await findPatientByUid(uid);
  if (!item) throw new Error("Patient not found");
  const itemId = validateNumericId(item.id, "item ID");

  const notesCol = item.column_values.find((c) => c.id === PORTAL_NOTES_COLUMN);
  const existing = notesCol?.text || "";

  const timestamp = new Date().toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
  const newEntry = `[${timestamp}] ${note}`;
  const updated = existing ? `${newEntry}\n\n${existing}` : newEntry;

  const colVal = JSON.stringify(JSON.stringify({ text: updated }));
  await mondayQuery(`mutation { change_simple_column_value(board_id: ${validateNumericId(SUBSCRIPTION_BOARD_ID)}, item_id: ${itemId}, column_id: "${PORTAL_NOTES_COLUMN}", value: ${colVal}) { id } }`);

  return true;
}

module.exports = {
  mondayQuery,
  findPatientByPhone,
  findPatientByUid,
  getPatientData,
  createPatientRequest,
  updatePatientData,
  appendPatientNote,
};
