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

  // Direct column search — scales to any board size
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

  // Prefer the item that has a UID (skip incomplete/duplicate entries)
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

  // Add an update (comment) with the details
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

// ─── Update patient fields in Monday ───

// Map of portal field names -> Monday column IDs and their types
const FIELD_TO_COLUMN = {
  name:              { col: null, type: "name" },         // Item name, special handling
  dob:               { col: COLUMNS.DOB, type: "text" },
  gender:            { col: COLUMNS.GENDER, type: "status" },
  address:           { col: COLUMNS.ADDRESS, type: "location" },
  phone:             { col: COLUMNS.PHONE, type: "phone" },
  email:             { col: COLUMNS.EMAIL, type: "email" },
  primaryInsurance:  { col: COLUMNS.PRIMARY_INS, type: "status" },
  memberId1:         { col: COLUMNS.MEMBER_ID_1, type: "text" },
  secondaryInsurance:{ col: COLUMNS.SECONDARY_INS, type: "status" },
  memberId2:         { col: COLUMNS.MEMBER_ID_2, type: "text" },
  doctorName:        { col: COLUMNS.DOCTOR_NAME, type: "text" },
  doctorAddress:     { col: COLUMNS.DOCTOR_ADDRESS, type: "location" },
  doctorPhone:       { col: COLUMNS.DOCTOR_PHONE, type: "phone" },
  sensorsType:       { col: COLUMNS.SENSORS_TYPE, type: "status" },
  suppliesType:      { col: COLUMNS.SUPPLIES_TYPE, type: "status" },
  infusionSet1:      { col: COLUMNS.INFUSION_SET_1, type: "status" },
  infQty1:           { col: COLUMNS.INF_QTY_1, type: "numeric" },
  infusionSet2:      { col: COLUMNS.INFUSION_SET_2, type: "status" },
  infQty2:           { col: COLUMNS.INF_QTY_2, type: "numeric" },
};

function isBlank(v) {
  return !v || v === "—" || v.trim() === "";
}

function buildColumnValue(type, value) {
  switch (type) {
    case "text":     return value;
    case "numeric":  return parseFloat(value) || 0;
    case "status":   return { label: value };
    case "phone": {
      const digits = value.replace(/\D/g, "");
      return digits ? { phone: digits, countryShortName: "US" } : "";
    }
    case "email":    return { email: value, text: value };
    case "location": return { address: value };
    default:         return value;
  }
}

async function updatePatientData(uid, updates) {
  const item = await findPatientByUid(uid);
  if (!item) throw new Error("Patient not found");
  const itemId = validateNumericId(item.id, "item ID");

  // Handle item name separately
  if (updates.name && updates.name !== item.name) {
    const cleanNew = updates.name.replace(/^\[TEST\]\s*/i, "").trim();
    if (cleanNew) {
      const newName = item.name.match(/^\[TEST\]\s*/i)
        ? `[TEST] ${cleanNew}`
        : cleanNew;
      await mondayQuery(`mutation { change_simple_column_value(board_id: ${validateNumericId(SUBSCRIPTION_BOARD_ID)}, item_id: ${itemId}, column_id: "name", value: ${JSON.stringify(newName)}) { id } }`);
    }
  }

  // Build column values object for batch update — skip blank/empty fields
  const columnValues = {};
  for (const [field, value] of Object.entries(updates)) {
    if (field === "name") continue;
    if (isBlank(value)) continue; // Don't write blanks to Monday
    const mapping = FIELD_TO_COLUMN[field];
    if (!mapping || !mapping.col) continue;
    columnValues[mapping.col] = buildColumnValue(mapping.type, value);
  }

  if (Object.keys(columnValues).length > 0) {
    const colValsStr = JSON.stringify(JSON.stringify(columnValues));

    await mondayQuery(`mutation { change_multiple_column_values(board_id: ${validateNumericId(SUBSCRIPTION_BOARD_ID)}, item_id: ${itemId}, column_values: ${colValsStr}) { id } }`);
  }

  return true;
}

// ─── Append note to Patient Portal Notes column ───

const PORTAL_NOTES_COLUMN = "long_text_mm3evvzj";

async function appendPatientNote(uid, note) {
  const item = await findPatientByUid(uid);
  if (!item) throw new Error("Patient not found");
  const itemId = validateNumericId(item.id, "item ID");

  // Get existing notes
  const notesCol = item.column_values.find((c) => c.id === PORTAL_NOTES_COLUMN);
  const existing = notesCol?.text || "";

  // Append with timestamp
  const timestamp = new Date().toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
  const newEntry = `[${timestamp}] ${note}`;
  const updated = existing ? `${newEntry}\n\n${existing}` : newEntry;

  // Write back -- long_text uses {text: "..."} format
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
