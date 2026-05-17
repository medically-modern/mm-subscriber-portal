// ─── Board & Column Configuration ───
// Maps Monday.com Subscription Board columns to portal data model

const SUBSCRIPTION_BOARD_ID = "18407459988";

// Column IDs — Subscription Board
const COLUMNS = {
  // Core subscription
  STATUS:           "color_mm2t7tdy",     // Active / Paused / Dead
  DAYS_TO_ORDER:    "color_mkxmtv9c",     // 10 Days, 20 Days, ... Today, Order Day Passed
  ORDERING_CYCLE:   "color_mkyjawhq",     // Benefits, Order, Next Order Awaiting, Confirm Order
  NEXT_ORDER:       "date_mkp0nvf1",      // Next order date
  SUBSCRIPTION:     "color_mm273mv8",     // Sensors / Supplies / Sensors & Supplies
  ORDER_TYPE:       "color_mm2w6kd",      // First Order / Reorder
  PATIENT_UID:      "text_mm3af3zt",      // Patient UID (links to pipeline)

  // Demographics
  DOB:              "text_mkvdefh1",
  GENDER:           "color_mm1zgyy2",
  PHONE:            "phone_mkp0q3cw",
  EMAIL:            "email_mkp01rrw",
  ADDRESS:          "location_mkp0rs0v",

  // Insurance
  PRIMARY_INS:      "color_mm254qxj",
  MEMBER_ID_1:      "text_mkvp6zfg",
  SECONDARY_INS:    "color_mm25cr82",
  MEMBER_ID_2:      "text_mm25cpx6",

  // Medical necessity
  CGM_COVERAGE:     "color_mm2cmgqe",
  MR_STATUS:        "color_mktyr8xg",     // MR Valid / etc
  MN_EXPIRY:        "date_mkp09gra",
  DIAGNOSIS:        "color_mkxrxv9w",

  // Sensors auth
  SENSORS_AUTH:     "color_mm25t997",
  SENSORS_AUTH_ID:  "text_mkwbkq9d",
  SENSORS_UNITS:    "numeric_mkwbzsg2",
  SENSORS_START:    "date_mkwb4q5e",
  SENSORS_END:      "date_mkwbvr6t",

  // Supplies auth
  SUPPLIES_AUTH:    "color_mm27snkq",
  INFUSION_AUTH_ID: "text_mm28v64f",
  CARTRIDGE_AUTH_ID:"text_mm255y04",
  SUPPLIES_UNITS:   "numeric_mm25mf8k",
  SUPPLIES_START:   "date_mm25csyr",
  SUPPLIES_END:     "date_mm255cs4",

  // Order details
  SENSORS_TYPE:     "color_mkxmdscr",     // FreeStyle Libre 3 Plus, Dexcom G7, etc
  SUPPLIES_TYPE:    "color_mkxmnheg",     // t:slim, Omnipod, etc
  INFUSION_SET_1:   "color_mkxm50f9",
  INF_QTY_1:        "numeric_mkw839ks",
  INFUSION_SET_2:   "color_mkxmx5wk",
  INF_QTY_2:        "numeric_mkwac234",

  // Doctor
  DOCTOR_NAME:      "text_mkxn3wza",
  DOCTOR_NPI:       "text_mkxnkgzg",
  DOCTOR_ADDRESS:   "location_mkxnbt7y",
  DOCTOR_PHONE:     "phone_mkxnv7e5",
  DOCTOR_FAX:       "email_mkxn9af2",

  // Subitems (for patient requests)
  SUBITEMS:         "subtasks_mkp0x6n",
};

// Column IDs to fetch for patient data (excludes internal/financial columns)
const PATIENT_COLUMNS = Object.values(COLUMNS);

// Auth configuration
const AUTH = {
  TOKEN_BYTES: 32,                    // 32 bytes = 64 hex chars
  TOKEN_TTL: 600,                     // 10 minutes for magic link
  JWT_EXPIRY: "30d",                  // 30-day session
  JWT_SECRET_ENV: "JWT_SECRET",       // env var name
  RATE_LIMIT_AUTH: 3,                 // max 3 link requests per phone per hour
  RATE_LIMIT_AUTH_WINDOW: 3600,       // 1 hour in seconds
};

// Groups
const GROUPS = {
  ACTIVE: "topics",
  NOT_ACTIVE: "group_mkp19fyp",
};

module.exports = { SUBSCRIPTION_BOARD_ID, COLUMNS, PATIENT_COLUMNS, AUTH, GROUPS };
