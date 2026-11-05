"use strict";

const config = window.MILKY_DEN_SUPABASE_CONFIG || {};
const loginPanel = document.querySelector("#loginPanel");
const loginForm = document.querySelector("#loginForm");
const loginButton = document.querySelector("#loginButton");
const loginNotice = document.querySelector("#loginNotice");
const dashboard = document.querySelector("#dashboard");
const dashboardNotice = document.querySelector("#dashboardNotice");
const customerRows = document.querySelector("#customerRows");
const emptyState = document.querySelector("#emptyState");
const detailDialog = document.querySelector("#detailDialog");
const redeemDialog = document.querySelector("#redeemDialog");
const pageSize = 20;

const state = {
  client: null,
  page: 1,
  total: 0,
  currentRecord: null,
  loading: false,
};

const summaryElements = {
  customers: document.querySelector("#totalCustomers"),
  spins: document.querySelector("#totalSpins"),
  softy: document.querySelector("#freeSoftyWinners"),
  topping: document.querySelector("#freeToppingWinners"),
  twenty: document.querySelector("#twentyOffWinners"),
  ten: document.querySelector("#tenOffWinners"),
  pending: document.querySelector("#pendingRedemptions"),
  redeemed: document.querySelector("#completedRedemptions"),
};

function setNotice(element, message, isError = true) {
  element.textContent = message;
  element.classList.toggle("notice-success", !isError && Boolean(message));
}

function hasSupabaseConfig() {
  return typeof config.url === "string"
    && /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(config.url)
    && typeof config.anonKey === "string"
    && config.anonKey.trim().length > 20;
}

async function getClient() {
  if (state.client) {
    return state.client;
  }
  if (!hasSupabaseConfig()) {
    throw new Error("Admin access is not configured. Add the Supabase project URL and publishable/anon key to assets/supabase-config.js.");
  }

  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  state.client = createClient(config.url.trim(), config.anonKey.trim(), {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
  });
  return state.client;
}

function displayPanel(isAuthenticated) {
  loginPanel.hidden = isAuthenticated;
  dashboard.hidden = !isAuthenticated;
}

function formatDate(value) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
}

function formatMoney(value) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(value);
}

function setSummary(summary) {
  summaryElements.customers.textContent = summary.total_customers ?? 0;
  summaryElements.spins.textContent = summary.total_spins ?? 0;
  summaryElements.softy.textContent = summary.free_softy_winners ?? 0;
  summaryElements.topping.textContent = summary.free_topping_winners ?? 0;
  summaryElements.twenty.textContent = summary.twenty_off_winners ?? 0;
  summaryElements.ten.textContent = summary.ten_off_winners ?? 0;
  summaryElements.pending.textContent = summary.pending_redemptions ?? 0;
  summaryElements.redeemed.textContent = summary.completed_redemptions ?? 0;
}

function addCell(row, text, className = "") {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (className) {
    cell.className = className;
  }
  row.append(cell);
  return cell;
}

function renderRows(rows) {
  customerRows.replaceChildren();
  for (const record of rows) {
    const row = document.createElement("tr");
    addCell(row, record.customer_name || "—");
    addCell(row, record.normalized_phone || "—");
    addCell(row, record.prize || "—", "prize-cell");
    addCell(row, formatDate(record.spin_timestamp));

    const statusCell = addCell(row, "");
    const status = document.createElement("span");
    const redemptionStatus = record.redemption_status || (record.spin_id ? "pending" : "not spun");
    const statusClass = redemptionStatus === "redeemed"
      ? "status-redeemed"
      : redemptionStatus === "pending"
        ? "status-pending"
        : "status-none";
    status.className = `status-pill ${statusClass}`;
    status.textContent = redemptionStatus;
    statusCell.append(status);

    const actionCell = addCell(row, "");
    const action = document.createElement("button");
    action.className = "row-action";
    action.type = "button";
    action.textContent = "VIEW DETAILS";
    action.addEventListener("click", () => openDetails(record));
    actionCell.append(action);
    customerRows.append(row);
  }

  const hasRows = rows.length > 0;
  emptyState.hidden = hasRows;
  if (!hasRows) {
    const filtered = Boolean(
      document.querySelector("#searchInput").value.trim()
      || document.querySelector("#prizeFilter").value
      || document.querySelector("#statusFilter").value,
    );
    document.querySelector("#emptyTitle").textContent = filtered ? "No matching records" : "No customer records yet";
    document.querySelector("#emptyCopy").textContent = filtered
      ? "Try another name, mobile number, prize, or redemption status."
      : "Records will appear here when the connected campaign has customer spins.";
  }
}

function getFilters() {
  return {
    p_search: document.querySelector("#searchInput").value.trim() || null,
    p_prize: document.querySelector("#prizeFilter").value || null,
    p_redemption_status: document.querySelector("#statusFilter").value || null,
    p_page: state.page,
    p_page_size: pageSize,
  };
}

async function loadDashboard() {
  if (state.loading) {
    return;
  }
  state.loading = true;
  setNotice(dashboardNotice, "");
  document.querySelector("#recordCount").textContent = "Loading…";
  try {
    const client = await getClient();
    const { data, error } = await client.rpc("admin_dashboard", getFilters());
    if (error) {
      throw error;
    }

    const result = data || {};
    setSummary(result.summary || {});
    state.total = Number(result.total || 0);
    renderRows(Array.isArray(result.rows) ? result.rows : []);
    document.querySelector("#recordCount").textContent = `${state.total} record${state.total === 1 ? "" : "s"}`;
    document.querySelector("#pageLabel").textContent = `Page ${state.page} of ${Math.max(1, Math.ceil(state.total / pageSize))}`;
    document.querySelector("#previousPage").disabled = state.page <= 1;
    document.querySelector("#nextPage").disabled = state.page * pageSize >= state.total;

    if (state.currentRecord) {
      const updatedRecord = (result.rows || []).find((record) => (
        state.currentRecord.spin_id
          ? record.spin_id === state.currentRecord.spin_id
          : state.currentRecord.id
            ? record.id === state.currentRecord.id
            : record.customer_id === state.currentRecord.customer_id && !record.spin_id
      ));
      if (updatedRecord) {
        state.currentRecord = updatedRecord;
        if (detailDialog.open) {
          populateDetails(updatedRecord);
        }
      }
    }
  } catch (error) {
    console.error("Unable to load the Milky Den admin dashboard.", error);
    setNotice(dashboardNotice, `Dashboard data could not be loaded: ${error.message || "Check the Supabase setup and database policies."}`);
    document.querySelector("#recordCount").textContent = "Unavailable";
    renderRows([]);
  } finally {
    state.loading = false;
  }
}

async function authorizeUser(user) {
  const client = await getClient();
  const { data, error } = await client
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw new Error(`Administrator access could not be verified: ${error.message}`);
  }
  if (!data) {
    await client.auth.signOut();
    throw new Error("This account is not authorized to access the Milky Den admin panel.");
  }

  document.querySelector("#accountEmail").textContent = user.email || "Authorized administrator";
  displayPanel(true);
  await loadDashboard();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setNotice(loginNotice, "");
  loginButton.disabled = true;
  loginButton.textContent = "SIGNING IN…";

  try {
    const client = await getClient();
    const formData = new FormData(loginForm);
    const { data, error } = await client.auth.signInWithPassword({
      email: String(formData.get("email") || "").trim(),
      password: String(formData.get("password") || ""),
    });
    if (error) {
      throw error;
    }
    if (!data.user) {
      throw new Error("Supabase did not return an authenticated user.");
    }
    await authorizeUser(data.user);
  } catch (error) {
    console.error("Milky Den admin sign-in failed.", error);
    setNotice(loginNotice, error.message || "Sign-in failed. Check the Supabase connection and try again.");
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "SIGN IN";
  }
});

document.querySelector("#signOutButton").addEventListener("click", async () => {
  const button = document.querySelector("#signOutButton");
  button.disabled = true;
  try {
    const client = await getClient();
    const { error } = await client.auth.signOut();
    if (error) {
      throw error;
    }
    displayPanel(false);
    loginForm.reset();
    setNotice(loginNotice, "");
  } catch (error) {
    console.error("Milky Den admin sign-out failed.", error);
    setNotice(dashboardNotice, `Sign-out failed: ${error.message}`);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#filterForm").addEventListener("submit", (event) => {
  event.preventDefault();
  state.page = 1;
  loadDashboard();
});

document.querySelector("#previousPage").addEventListener("click", () => {
  if (state.page > 1) {
    state.page -= 1;
    loadDashboard();
  }
});

document.querySelector("#nextPage").addEventListener("click", () => {
  if (state.page * pageSize < state.total) {
    state.page += 1;
    loadDashboard();
  }
});

function populateDetails(record) {
  document.querySelector("#detailName").textContent = record.customer_name || "—";
  document.querySelector("#detailPhone").textContent = record.normalized_phone || "—";
  document.querySelector("#detailPrize").textContent = record.prize || "—";
  document.querySelector("#detailSpinDate").textContent = formatDate(record.spin_timestamp);
  document.querySelector("#detailStatus").textContent = record.redemption_status
    || (record.spin_id ? "pending" : "not spun");
  document.querySelector("#detailRedeemedAt").textContent = formatDate(record.redeemed_at);
  document.querySelector("#detailRedeemedBy").textContent = record.redeemed_by || "—";

  const isTwentyOff = record.prize === "20% OFF";
  document.querySelector("#detailCondition").hidden = !isTwentyOff;
  document.querySelector("#purchaseDetailRow").hidden = !isTwentyOff || record.purchase_total === null;
  document.querySelector("#detailPurchaseTotal").textContent = formatMoney(record.purchase_total);
  const canRedeem = Boolean(record.spin_id || record.id);
  document.querySelector("#openRedeemButton").disabled = !canRedeem || record.redemption_status === "redeemed";
  document.querySelector("#openRedeemButton").textContent = !canRedeem
    ? "NO PRIZE TO REDEEM"
    : record.redemption_status === "redeemed"
      ? "ALREADY REDEEMED"
      : "MARK AS REDEEMED";
  setNotice(document.querySelector("#detailNotice"), "");
}

function openDetails(record) {
  state.currentRecord = record;
  populateDetails(record);
  detailDialog.showModal();
}

document.querySelector("#openRedeemButton").addEventListener("click", () => {
  if (!state.currentRecord
    || (!state.currentRecord.spin_id && !state.currentRecord.id)
    || state.currentRecord.redemption_status === "redeemed") {
    return;
  }
  const isTwentyOff = state.currentRecord.prize === "20% OFF";
  document.querySelector("#confirmPrize").textContent = state.currentRecord.prize;
  document.querySelector("#redeemCondition").hidden = !isTwentyOff;
  document.querySelector("#purchaseAmountField").hidden = !isTwentyOff;
  document.querySelector("#purchaseAmount").required = isTwentyOff;
  document.querySelector("#purchaseAmount").value = "";
  setNotice(document.querySelector("#redeemNotice"), "");
  detailDialog.close();
  redeemDialog.showModal();
});

document.querySelector("#cancelRedeemButton").addEventListener("click", () => redeemDialog.close());

document.querySelector("#confirmRedeemButton").addEventListener("click", async () => {
  if (!state.currentRecord) {
    return;
  }

  const purchaseInput = document.querySelector("#purchaseAmount");
  const isTwentyOff = state.currentRecord.prize === "20% OFF";
  const purchaseTotal = isTwentyOff ? Number(purchaseInput.value) : null;
  if (isTwentyOff && (!Number.isFinite(purchaseTotal) || purchaseTotal < 500)) {
    setNotice(document.querySelector("#redeemNotice"), "Enter a purchase total of at least ₹500 to redeem this prize.");
    purchaseInput.focus();
    return;
  }

  const button = document.querySelector("#confirmRedeemButton");
  button.disabled = true;
  button.textContent = "SAVING…";
  setNotice(document.querySelector("#redeemNotice"), "");
  try {
    const client = await getClient();
    const { data, error } = await client.rpc("admin_redeem_spin", {
      p_spin_id: state.currentRecord.spin_id || state.currentRecord.id,
      p_purchase_total: purchaseTotal,
    });
    if (error) {
      throw error;
    }
    if (!data || data.redemption_status !== "redeemed") {
      throw new Error("The database did not confirm the redemption.");
    }

    state.currentRecord = { ...state.currentRecord, ...data };
    redeemDialog.close();
    await loadDashboard();
    const refreshedRecord = state.currentRecord;
    if (refreshedRecord) {
      populateDetails(refreshedRecord);
      detailDialog.showModal();
      setNotice(document.querySelector("#detailNotice"), "Redemption saved successfully.", false);
    }
  } catch (error) {
    console.error("Milky Den prize redemption failed.", error);
    setNotice(document.querySelector("#redeemNotice"), `Redemption could not be saved: ${error.message || "Check the database connection."}`);
  } finally {
    button.disabled = false;
    button.textContent = "CONFIRM REDEMPTION";
  }
});

async function restoreSession() {
  if (!hasSupabaseConfig()) {
    loginButton.disabled = true;
    setNotice(loginNotice, "Admin access is not configured. Add the Supabase project URL and publishable/anon key to assets/supabase-config.js.");
    return;
  }

  try {
    const client = await getClient();
    const { data, error } = await client.auth.getSession();
    if (error) {
      throw error;
    }
    if (data.session?.user) {
      await authorizeUser(data.session.user);
    }
  } catch (error) {
    console.error("Unable to restore the Milky Den admin session.", error);
    setNotice(loginNotice, error.message || "Admin session could not be restored.");
  }
}

restoreSession();
