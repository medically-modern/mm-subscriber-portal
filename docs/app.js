// ─── Configuration ───
const API_BASE = "https://mm-patient-portal-production.up.railway.app";

// ─── State ───
let patientData = null;
let currentRequestType = null;

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
  const res = await fetch(url, {
    credentials: "include", // Send cookies
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Something went wrong");
  }
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

  // Clean name (strip [TEST] prefix)
  const cleanName = d.name.replace(/^\[TEST\]\s*/i, "");

  // ═══ Dashboard ═══
  document.getElementById("greeting").textContent = `Hi ${cleanName}!`;

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
  setText("sub-sensor-type", d.sensorsType);
  setText("sub-sensor-units", d.sensorsUnits);
  setText("sub-supplies-type", d.suppliesType);
  setText("sub-inf1", d.infusionSet1);
  setText("sub-inf-qty1", d.infQty1);
  setText("sub-inf2", d.infusionSet2);
  setText("sub-inf-qty2", d.infQty2);
  setText("sub-supplies-units", d.suppliesUnits);

  // ═══ My Info ═══
  setText("info-name", cleanName);
  setText("info-dob", d.dob);
  setText("info-gender", d.gender);
  setText("info-address", d.address);
  setText("info-phone", formatPhone(d.phone));
  setText("info-email", d.email);
  setText("info-primary-ins", d.primaryInsurance);
  setText("info-member1", d.memberId1);
  setText("info-secondary-ins", d.secondaryInsurance);
  setText("info-member2", d.memberId2);
  setText("info-doctor", d.doctorName);
  setText("info-doctor-addr", d.doctorAddress);
  setText("info-doctor-phone", formatPhone(d.doctorPhone));

  // ═══ Coverage & Auth ═══
  setText("cov-mr", d.mrStatus);
  setText("cov-mn-expiry", formatDate(d.mnExpiry));
  setText("cov-cgm", d.cgmCoverage);
  setText("cov-diagnosis", d.diagnosis);
  setText("cov-sensors-auth", d.sensorsAuth);
  setText("cov-sensors-auth-id", d.sensorsAuthId);
  setText("cov-sensors-units", d.sensorsUnits);
  setText("cov-sensors-start", formatDate(d.sensorsStart));
  setText("cov-sensors-end", formatDate(d.sensorsEnd));
  setText("cov-supplies-auth", d.suppliesAuth);
  setText("cov-inf-auth-id", d.infusionAuthId);
  setText("cov-cart-auth-id", d.cartridgeAuthId);
  setText("cov-supplies-units", d.suppliesUnits);
  setText("cov-supplies-start", formatDate(d.suppliesStart));
  setText("cov-supplies-end", formatDate(d.suppliesEnd));
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

// ─── Request modal ───
function openRequestModal(type) {
  currentRequestType = type;

  const titles = {
    pause: "Pause Subscription",
    resume: "Resume Subscription",
    change_subscription: "Change Subscription",
    update_info: "Update My Information",
    question: "Ask a Question",
  };
  const descs = {
    pause: "Let us know why you'd like to pause and when you'd like to resume.",
    resume: "We'll get your subscription back up and running.",
    change_subscription: "Tell us what you'd like to change about your subscription.",
    update_info: "Let us know what information needs to be updated.",
    question: "What can we help you with?",
  };

  document.getElementById("modal-title").textContent = titles[type] || "Submit Request";
  document.getElementById("modal-desc").textContent = descs[type] || "";
  document.getElementById("modal-details").value = "";
  document.getElementById("modal-error").style.display = "none";
  document.getElementById("request-modal").style.display = "flex";
}

function closeRequestModal(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById("request-modal").style.display = "none";
  currentRequestType = null;
}

async function submitRequest() {
  const details = document.getElementById("modal-details").value.trim();
  if (!details) {
    showError("modal-error", "Please provide some details.");
    return;
  }

  const btn = document.getElementById("modal-submit");
  btn.disabled = true;
  btn.textContent = "Submitting...";

  try {
    const res = await api("/api/me/request", {
      method: "POST",
      body: { type: currentRequestType, details },
    });

    closeRequestModal();

    // Show success (brief inline notification)
    alert(res.message);

    // Refresh data
    await loadPortal();
  } catch (err) {
    showError("modal-error", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Submit";
  }
}

// ─── Helpers ───
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || "—";
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

// ─── Start ───
init();
