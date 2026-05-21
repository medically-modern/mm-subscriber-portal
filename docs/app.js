// ─── Configuration ───
const API_BASE = "https://mm-patient-portal-production.up.railway.app";

// ─── State ───
let patientData = null;

// Store lat/lng from Google Places for address writes
const addressCoords = {
  address: { lat: 0, lng: 0 },
  doctorAddress: { lat: 0, lng: 0 },
};

// ─── Google Places Autocomplete ───

let _mapsLoaded = false;
let _mapsLoading = false;
const _mapsCallbacks = [];

function stripZipPlus4(addr) {
  return addr.replace(/(\b\d{5})-\d{4}\b/g, "$1");
}

function buildFullAddress(place) {
  const components = place.address_components || [];
  const get = (type) => components.find((c) => c.types.includes(type))?.long_name || "";

  const streetNumber = get("street_number");
  const route = get("route");
  const subpremise = get("subpremise");
  const city = get("locality") || get("sublocality_level_1") || get("administrative_area_level_3");
  const state = (components.find((c) => c.types.includes("administrative_area_level_1"))?.short_name) || "";
  const zip = get("postal_code");
  const country = (components.find((c) => c.types.includes("country"))?.short_name) || "";

  let street = [streetNumber, route].filter(Boolean).join(" ");
  if (subpremise) street += ` ${subpremise}`;
  const parts = [street, city, [state, zip].filter(Boolean).join(" ")].filter(Boolean);
  let addr = parts.join(", ");
  if (country) addr += `, ${country}`;
  return addr;
}

async function loadGooglePlaces(apiKey) {
  if (_mapsLoaded) return;
  if (_mapsLoading) {
    return new Promise((resolve) => _mapsCallbacks.push(resolve));
  }
  _mapsLoading = true;

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.onload = () => {
      _mapsLoaded = true;
      _mapsLoading = false;
      _mapsCallbacks.forEach((cb) => cb());
      _mapsCallbacks.length = 0;
      resolve();
    };
    script.onerror = () => {
      _mapsLoading = false;
      reject(new Error("Google Maps SDK failed to load"));
    };
    document.head.appendChild(script);
  });
}

function attachAutocomplete(inputId, coordsKey) {
  const input = document.getElementById(inputId);
  if (!input || !window.google?.maps?.places?.Autocomplete) return;

  const autocomplete = new google.maps.places.Autocomplete(input, {
    componentRestrictions: { country: "us" },
    types: ["address"],
    fields: ["address_components", "formatted_address", "geometry"],
  });

  autocomplete.addListener("place_changed", () => {
    const place = autocomplete.getPlace();
    if (!place) return;

    let addr = "";
    if (place.address_components?.length > 0) {
      addr = buildFullAddress(place);
    } else {
      addr = place.formatted_address || input.value || "";
    }
    if (!addr) return;

    addr = stripZipPlus4(addr);
    input.value = addr;

    let lat = 0, lng = 0;
    if (place.geometry?.location) {
      lat = place.geometry.location.lat();
      lng = place.geometry.location.lng();
    }

    addressCoords[coordsKey] = { lat, lng };
  });
}

async function initAutocomplete() {
  try {
    const res = await api("/api/config");
    if (!res.googleMapsKey) return;
    await loadGooglePlaces(res.googleMapsKey);
    attachAutocomplete("edit-info-address", "address");
    attachAutocomplete("edit-info-doctor-addr", "doctorAddress");
  } catch (err) {
    console.warn("Google Places autocomplete not available:", err.message);
  }
}

// ─── Initialization ───
async function init() {
  // Check for auth token in URL (magic link callback)
  const params = new URLSearchParams(window.location.search);
  const authToken = params.get("auth");

  if (authToken) {
    // Verify magic link
    showView("loading");
    try {
      const res = await api("/auth/verify/" + authToken, { method: "GET" });
      if (res.success) {
        // Store session token for cross-origin auth
        if (res.token) {
          sessionStorage.setItem("session_token", res.token);
        }
        // Clean URL
        window.history.replaceState({}, "", window.location.pathname);
        await loadPortal();
        return;
      }
    } catch (err) {
      showView("login");
      showError("login-error", err.message || "This link has expired. Please request a new one.");
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }
  }

  // Check existing session
  showView("loading");
  try {
    const res = await api("/auth/check");
    if (res.authenticated) {
      await loadPortal();
      return;
    }
  } catch {
    // Not authenticated
  }

  showView("login");
}

// ─── API helper ───
async function api(path, options = {}) {
  const url = API_BASE + path;
  const headers = { "Content-Type": "application/json" };

  // Send JWT via Authorization header (cross-origin safe — cookies blocked by browsers)
  const token = sessionStorage.getItem("session_token");
  if (token) {
    headers["Authorization"] = "Bearer " + token;
  }

  const res = await fetch(url, {
    credentials: "include", // Also try cookies (same-origin fallback)
    headers,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json();
  if (!res.ok && res.status !== 207) {
    throw new Error(data.error || "Something went wrong");
  }
  // Attach status so callers can detect 207 partial saves
  data._status = res.status;
  return data;
}

// ─── View management ───
function showView(name) {
  document.getElementById("login-view").style.display = name === "login" ? "" : "none";
  document.getElementById("loading-view").style.display = name === "loading" ? "" : "none";
  document.getElementById("portal-view").style.display = name === "portal" ? "" : "none";
  document.getElementById("logout-btn").style.display = name === "portal" ? "" : "none";
}

// ─── Auth: Request magic link ───
async function handleRequestLink() {
  const phone = document.getElementById("phone-input").value.replace(/\D/g, "");
  const btn = document.getElementById("send-link-btn");
  const errorEl = document.getElementById("login-error");
  const infoEl = document.getElementById("login-info");

  errorEl.style.display = "none";
  infoEl.style.display = "none";

  if (phone.length < 10) {
    showError("login-error", "Please enter a valid 10-digit phone number.");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Sending...";

  try {
    const res = await api("/auth/request-link", {
      method: "POST",
      body: { phone },
    });

    infoEl.textContent = res.message;
    infoEl.style.display = "block";
    btn.textContent = "Link Sent!";

    // Re-enable after 60 seconds
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = "Send Sign-In Link";
    }, 60000);
  } catch (err) {
    showError("login-error", err.message);
    btn.disabled = false;
    btn.textContent = "Send Sign-In Link";
  }
}

// ─── Auth: Logout ───
async function handleLogout() {
  try {
    await api("/auth/logout", { method: "POST" });
  } catch {
    // Logout even if API fails
  }
  sessionStorage.removeItem("session_token");
  patientData = null;
  showView("login");
}

// ─── Load portal data ───
async function loadPortal() {
  showView("loading");

  try {
    patientData = await api("/api/me");
    renderPortal();
    showView("portal");
    initAutocomplete(); // non-blocking, loads Google Places for address fields
  } catch (err) {
    console.error("Failed to load portal:", err);
    showView("login");
    showError("login-error", "Unable to load your data. Please sign in again.");
  }
}

// ─── Render all portal sections ───
function renderPortal() {
  const d = patientData;
  if (!d) return;

  // ═══ Dashboard ═══
  document.getElementById("greeting").textContent = `Hi ${d.name}!`;

  const statusPill = document.getElementById("status-pill");
  statusPill.textContent = d.status || "—";
  statusPill.style.background = d.status === "Active" ? "rgba(255,255,255,0.25)" :
    d.status === "Paused" ? "rgba(253,171,61,0.3)" : "rgba(255,255,255,0.15)";

  const orderPill = document.getElementById("order-type-pill");
  orderPill.textContent = d.orderType || "—";

  // Next order
  if (d.nextOrder) {
    const orderDate = new Date(d.nextOrder + "T00:00:00");
    const options = { weekday: "long", month: "long", day: "numeric", year: "numeric" };
    document.getElementById("next-order-date").textContent = orderDate.toLocaleDateString("en-US", options);

    const now = new Date();
    const diff = Math.ceil((orderDate - now) / (1000 * 60 * 60 * 24));
    const countdown = document.getElementById("next-order-countdown");
    if (diff > 0) {
      countdown.textContent = `${diff} day${diff !== 1 ? "s" : ""} away`;
    } else if (diff === 0) {
      countdown.textContent = "Today!";
    } else {
      countdown.textContent = `${Math.abs(diff)} day${Math.abs(diff) !== 1 ? "s" : ""} ago`;
    }
  } else {
    document.getElementById("next-order-date").textContent = "Not scheduled";
    document.getElementById("next-order-countdown").textContent = "";
  }

  setText("ordering-cycle", d.orderingCycle);
  setText("dash-subscription", d.subscription);
  setText("dash-sensors", d.sensorsType);
  setText("dash-supplies", d.suppliesType);
  setText("dash-days", d.daysToOrder);

  // ═══ My Subscription ═══
  setText("sub-status", d.status);
  setText("sub-type", d.subscription);
  setText("sub-order-type", d.orderType);
  setText("sub-cycle", d.orderingCycle);
  setText("sub-next-order", formatDate(d.nextOrder));
  setText("sub-days", d.daysToOrder);
  setInput("edit-sub-sensor-type", d.sensorsType);
  setText("sub-sensor-units", d.sensorsUnits);
  setInput("edit-sub-supplies-type", d.suppliesType);
  setInput("edit-sub-inf1", d.infusionSet1);
  setInput("edit-sub-inf-qty1", d.infQty1);
  setInput("edit-sub-inf2", d.infusionSet2);
  setInput("edit-sub-inf-qty2", d.infQty2);
  setText("sub-supplies-units", d.suppliesUnits);

  // ═══ Conditional visibility ═══
  const sensorsNotServing = !d.sensorsType || d.sensorsType === "Not Serving";
  document.getElementById("sensors-card").style.display = sensorsNotServing ? "none" : "";
  document.getElementById("dash-sensors-row").style.display = sensorsNotServing ? "none" : "";

  const inf2Empty = !d.infusionSet2 || d.infusionSet2 === "—" || d.infusionSet2 === "";
  document.getElementById("inf2-row").style.display = inf2Empty ? "none" : "";
  document.getElementById("inf2-qty-row").style.display = inf2Empty ? "none" : "";

  // ═══ My Info ═══
  setInput("edit-info-name", d.name);
  setInput("edit-info-dob", d.dob);
  setInput("edit-info-gender", d.gender);
  setInput("edit-info-address", d.address);
  setInput("edit-info-phone", formatPhone(d.phone));
  setInput("edit-info-email", d.email);
  setInput("edit-info-primary-ins", d.primaryInsurance);
  setInput("edit-info-member1", d.memberId1);
  setInput("edit-info-secondary-ins", d.secondaryInsurance);
  setInput("edit-info-member2", d.memberId2);
  setInput("edit-info-doctor", d.doctorName);
  setInput("edit-info-doctor-addr", d.doctorAddress);
  setInput("edit-info-doctor-phone", formatPhone(d.doctorPhone));

  // ═══ Coverage ═══
  setText("cov-mr", d.mrStatus);
  setText("cov-mn-expiry", formatDate(d.mnExpiry));
  setText("cov-cgm", d.cgmCoverage);
  setText("cov-diagnosis", d.diagnosis);
}

// ─── Tab switching ───
function switchTab(tabName) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach((tc) => tc.classList.remove("active"));

  document.querySelector(`.tab[data-tab="${tabName}"]`).classList.add("active");
  document.getElementById("tab-" + tabName).classList.add("active");

  // Scroll to top of content
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ─── Save Info ───
async function saveInfo() {
  const btn = document.getElementById("info-save-btn");
  const errorEl = document.getElementById("info-save-error");
  const successEl = document.getElementById("info-save-success");
  errorEl.style.display = "none";
  successEl.style.display = "none";
  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    const updates = {
      name: document.getElementById("edit-info-name").value.trim(),
      dob: document.getElementById("edit-info-dob").value.trim(),
      gender: document.getElementById("edit-info-gender").value.trim(),
      address: document.getElementById("edit-info-address").value.trim(),
      addressLat: addressCoords.address.lat,
      addressLng: addressCoords.address.lng,
      phone: document.getElementById("edit-info-phone").value.trim(),
      email: document.getElementById("edit-info-email").value.trim(),
      primaryInsurance: document.getElementById("edit-info-primary-ins").value.trim(),
      memberId1: document.getElementById("edit-info-member1").value.trim(),
      secondaryInsurance: document.getElementById("edit-info-secondary-ins").value.trim(),
      memberId2: document.getElementById("edit-info-member2").value.trim(),
      doctorName: document.getElementById("edit-info-doctor").value.trim(),
      doctorAddress: document.getElementById("edit-info-doctor-addr").value.trim(),
      doctorAddressLat: addressCoords.doctorAddress.lat,
      doctorAddressLng: addressCoords.doctorAddress.lng,
      doctorPhone: document.getElementById("edit-info-doctor-phone").value.trim(),
    };
    const res = await api("/api/me/update", { method: "POST", body: updates });
    if (res._status === 207) {
      // Partial save — some fields failed
      errorEl.textContent = `Could not save: ${res.failedFields.join(", ")}`;
      errorEl.style.display = "block";
      if (res.saved > 0) {
        successEl.textContent = `${res.saved} field(s) saved successfully.`;
        successEl.style.display = "block";
      }
    } else {
      successEl.textContent = "Changes saved!";
      successEl.style.display = "block";
    }
    await loadPortal();
    setTimeout(() => { successEl.style.display = "none"; }, 4000);
  } catch (err) {
    showError("info-save-error", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Save Changes";
  }
}

// ─── Save Subscription ───
async function saveSubscription() {
  const btn = document.getElementById("sub-save-btn");
  const errorEl = document.getElementById("sub-save-error");
  const successEl = document.getElementById("sub-save-success");
  errorEl.style.display = "none";
  successEl.style.display = "none";
  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    const updates = {
      sensorsType: document.getElementById("edit-sub-sensor-type").value.trim(),
      suppliesType: document.getElementById("edit-sub-supplies-type").value.trim(),
      infusionSet1: document.getElementById("edit-sub-inf1").value.trim(),
      infQty1: document.getElementById("edit-sub-inf-qty1").value.trim(),
      infusionSet2: document.getElementById("edit-sub-inf2").value.trim(),
      infQty2: document.getElementById("edit-sub-inf-qty2").value.trim(),
    };
    const res = await api("/api/me/update", { method: "POST", body: updates });
    if (res._status === 207) {
      errorEl.textContent = `Could not save: ${res.failedFields.join(", ")}`;
      errorEl.style.display = "block";
      if (res.saved > 0) {
        successEl.textContent = `${res.saved} field(s) saved successfully.`;
        successEl.style.display = "block";
      }
    } else {
      successEl.textContent = "Changes saved!";
      successEl.style.display = "block";
    }
    await loadPortal();
    setTimeout(() => { successEl.style.display = "none"; }, 4000);
  } catch (err) {
    showError("sub-save-error", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Save Changes";
  }
}

// ─── Save Note ───
async function saveNote() {
  const note = document.getElementById("sub-note").value.trim();
  if (!note) {
    showError("sub-note-error", "Please write a note.");
    return;
  }
  const btn = document.getElementById("sub-note-btn");
  const errorEl = document.getElementById("sub-note-error");
  const successEl = document.getElementById("sub-note-success");
  errorEl.style.display = "none";
  successEl.style.display = "none";
  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    const res = await api("/api/me/note", { method: "POST", body: { note } });
    successEl.textContent = "Note saved!";
    successEl.style.display = "block";
    document.getElementById("sub-note").value = "";
    setTimeout(() => { successEl.style.display = "none"; }, 3000);
  } catch (err) {
    showError("sub-note-error", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Save Note";
  }
}

// ─── Helpers ───
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || "—";
}

function setInput(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const v = value || "";
  if (el.tagName === "SELECT") {
    // Try exact match first, then normalized match (strip special Unicode spaces)
    const normalize = (s) => s.replace(/[  ]/g, " ").trim();
    const opts = Array.from(el.options);
    const exact = opts.find((o) => o.value === v);
    if (exact) { el.value = v; return; }
    const norm = opts.find((o) => normalize(o.value) === normalize(v));
    if (norm) { el.value = norm.value; return; }
    el.value = "";
  } else {
    el.value = v;
  }
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatPhone(phone) {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

function showError(id, msg) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = msg;
    el.style.display = "block";
  }
}

// ─── Phone input formatting ───
document.getElementById("phone-input").addEventListener("input", function () {
  let val = this.value.replace(/\D/g, "");
  if (val.length > 10) val = val.slice(0, 10);
  if (val.length >= 6) this.value = `(${val.slice(0, 3)}) ${val.slice(3, 6)}-${val.slice(6)}`;
  else if (val.length >= 3) this.value = `(${val.slice(0, 3)}) ${val.slice(3)}`;
  else if (val.length > 0) this.value = `(${val}`;
  else this.value = "";
});

document.getElementById("phone-input").addEventListener("keyup", function (e) {
  if (e.key === "Enter") handleRequestLink();
});

// ─── Pause Order Modal ───
function openPauseModal() {
  document.getElementById("pause-modal").style.display = "flex";
  document.getElementById("pause-reason").value = "";
  document.getElementById("pause-error").style.display = "none";
  document.getElementById("pause-success").style.display = "none";
  document.getElementById("pause-submit-btn").disabled = false;
  document.getElementById("pause-submit-btn").textContent = "Confirm Pause Request";
}

function closePauseModal(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById("pause-modal").style.display = "none";
}

async function submitPause() {
  const reason = document.getElementById("pause-reason").value.trim();
  if (!reason) {
    showError("pause-error", "Please tell us why you'd like to pause.");
    return;
  }
  const btn = document.getElementById("pause-submit-btn");
  const errorEl = document.getElementById("pause-error");
  const successEl = document.getElementById("pause-success");
  errorEl.style.display = "none";
  successEl.style.display = "none";
  btn.disabled = true;
  btn.textContent = "Submitting...";

  try {
    await api("/api/me/pause", { method: "POST", body: { reason } });
    successEl.textContent = "Your subscription has been paused.";
    successEl.style.display = "block";
    btn.textContent = "Submitted!";
    setTimeout(() => { closePauseModal(); }, 2500);
  } catch (err) {
    showError("pause-error", err.message);
    btn.disabled = false;
    btn.textContent = "Confirm Pause Request";
  }
}

// ─── Start ───
init();
