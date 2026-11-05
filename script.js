"use strict";

const campaignConfig = {
  redemptionConditions: {
    "20% OFF": "20% OFF is valid only on purchases of ₹500 or more.",
  },
};

const prizes = [
  { label: "FREE SOFTY", lines: ["FREE", "SOFTY"], prize: "FREE SOFTY", color: "#ffb8cb", ink: "#81374f" },
  { label: "10% OFF", lines: ["10%", "OFF"], prize: "10% OFF", color: "#ffe38a", ink: "#78501e" },
  { label: "BETTER LUCK NEXT TIME", lines: ["BETTER LUCK", "NEXT TIME"], prize: "BETTER LUCK NEXT TIME", color: "#bfe9d5", ink: "#356b59" },
  { label: "20% OFF", lines: ["20%", "OFF"], prize: "20% OFF", color: "#d9c8ff", ink: "#5d4789" },
  { label: "FREE TOPPING", lines: ["FREE", "TOPPING"], prize: "FREE TOPPING", color: "#ffc4a5", ink: "#874b3d" },
  { label: "10% OFF", lines: ["10%", "OFF"], prize: "10% OFF", color: "#fff0a8", ink: "#78501e" },
  { label: "BETTER LUCK NEXT TIME", lines: ["BETTER LUCK", "NEXT TIME"], prize: "BETTER LUCK NEXT TIME", color: "#bcebf0", ink: "#356475" },
  { label: "20% OFF", lines: ["20%", "OFF"], prize: "20% OFF", color: "#ffc6dc", ink: "#81374f" },
];

const registrationScreen = document.querySelector("#registrationScreen");
const wheelScreen = document.querySelector("#wheelScreen");
const registrationForm = document.querySelector("#registrationForm");
const customerNameInput = document.querySelector("#customerName");
const customerPhoneInput = document.querySelector("#customerPhone");
const nameError = document.querySelector("#nameError");
const phoneError = document.querySelector("#phoneError");
const storageError = document.querySelector("#storageError");
const wheelDisc = document.querySelector("#wheelDisc");
const canvas = document.querySelector("#prizeWheel");
const spinButton = document.querySelector("#spinButton");
const buttonLabel = document.querySelector(".button-label");
const spinNote = document.querySelector("#spinNote");
const resultScreen = document.querySelector("#resultScreen");
const savedPrize = document.querySelector("#savedPrize");
const resultMessage = document.querySelector("#resultMessage");
const redemptionNote = document.querySelector("#redemptionNote");
const context = canvas.getContext("2d");
const sliceAngle = (Math.PI * 2) / prizes.length;
const spinDuration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1400 : 5200;
let player = null;
let currentRotation = 0;
let hasSpun = false;
let supabaseClientPromise = null;

function getSupabaseClient() {
  const config = window.MILKY_DEN_SUPABASE_CONFIG;
  if (!config
    || typeof config.url !== "string"
    || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(config.url)
    || typeof config.anonKey !== "string"
    || config.anonKey.trim().length <= 20) {
    return Promise.reject(new Error("Supabase is not configured. Check assets/supabase-config.js."));
  }

  if (!supabaseClientPromise) {
    supabaseClientPromise = import("https://esm.sh/@supabase/supabase-js@2")
      .then(({ createClient }) => createClient(config.url.trim(), config.anonKey.trim(), {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      }))
      .catch((error) => {
        supabaseClientPromise = null;
        throw new Error(`Supabase client could not be loaded: ${error.message}`);
      });
  }
  return supabaseClientPromise;
}

async function registerCustomerWithSupabase(customer) {
  const client = await getSupabaseClient();
  const { data, error } = await client.rpc("register_customer", {
    p_name: customer.name,
    p_phone: customer.phone,
  });
  if (error) {
    throw error;
  }
  if (data?.status === "rate_limited") {
    return data;
  }
  if (!data || !["ready", "already_played"].includes(data.status)) {
    throw new Error("Supabase returned an unexpected registration response.");
  }
  if (data.normalized_phone !== customer.phone) {
    throw new Error("Supabase returned a different customer phone number.");
  }
  if (data.status === "already_played"
    && (!prizes.some((prize) => prize.prize === data.prize)
      || typeof data.spin_timestamp !== "string")) {
    throw new Error("Supabase returned an incomplete saved spin result.");
  }
  return data;
}

function showSavedSupabaseResult(data) {
  showCompletedResult({
    name: data.name || player.name,
    phone: data.normalized_phone || player.phone,
    prize: data.prize,
    spunAt: data.spin_timestamp,
    status: "completed",
  });
}

function drawWheel() {
  const bounds = canvas.getBoundingClientRect();
  const size = Math.floor(Math.min(bounds.width, bounds.height));
  if (!size) {
    return;
  }

  const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(size * pixelRatio);
  canvas.height = Math.round(size * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  const center = size / 2;
  const radius = size / 2;
  const labelRadius = radius * 0.59;
  context.clearRect(0, 0, size, size);

  prizes.forEach((prize, index) => {
    const startAngle = -Math.PI / 2 + index * sliceAngle;
    const endAngle = startAngle + sliceAngle;
    const middleAngle = startAngle + sliceAngle / 2;

    context.beginPath();
    context.moveTo(center, center);
    context.arc(center, center, radius, startAngle, endAngle);
    context.closePath();

    const gradient = context.createRadialGradient(
      center - radius * 0.18,
      center - radius * 0.2,
      radius * 0.06,
      center,
      center,
      radius * 1.08,
    );
    gradient.addColorStop(0, "#fffefa");
    gradient.addColorStop(0.2, prize.color);
    gradient.addColorStop(0.88, prize.color);
    gradient.addColorStop(1, "rgba(84, 69, 122, 0.13)");
    context.fillStyle = gradient;
    context.fill();
    drawSprinkles(center, radius, index, middleAngle, size);
    drawLabel(prize, center, labelRadius, middleAngle, size);
  });

  drawDividers(center, radius, size);

  context.beginPath();
  context.arc(center, center, radius - Math.max(2, size * 0.006), 0, Math.PI * 2);
  context.lineWidth = Math.max(2, size * 0.012);
  context.strokeStyle = "#fffefa";
  context.stroke();
}

function drawDividers(center, radius, size) {
  context.save();
  context.lineCap = "round";
  context.lineWidth = Math.max(3, size * 0.012);
  context.strokeStyle = "#fffefa";
  for (let index = 0; index < prizes.length; index += 1) {
    const angle = -Math.PI / 2 + index * sliceAngle;
    context.beginPath();
    context.moveTo(center, center);
    context.lineTo(
      center + Math.cos(angle) * radius * 0.99,
      center + Math.sin(angle) * radius * 0.99,
    );
    context.stroke();
  }
  context.restore();
}

function drawSprinkles(center, radius, index, middleAngle, size) {
  const palette = ["#fffefa", "#ff7197", "#7dcaad", "#8d75d6", "#f0a83d"];
  const sprinkles = [
    { angle: middleAngle - 0.19, radius: 0.79, turn: 0.45 },
    { angle: middleAngle + 0.18, radius: 0.84, turn: -0.55 },
    { angle: middleAngle + (index % 2 ? -0.08 : 0.08), radius: 0.72, turn: 0.9 },
  ];
  context.save();
  sprinkles.forEach((sprinkle, sprinkleIndex) => {
    const x = center + Math.cos(sprinkle.angle) * radius * sprinkle.radius;
    const y = center + Math.sin(sprinkle.angle) * radius * sprinkle.radius;
    context.save();
    context.translate(x, y);
    context.rotate(sprinkle.angle + sprinkle.turn);
    context.lineCap = "round";
    context.lineWidth = Math.max(2, size * 0.009);
    context.strokeStyle = palette[(index + sprinkleIndex) % palette.length];
    context.beginPath();
    context.moveTo(-size * 0.012, 0);
    context.lineTo(size * 0.012, 0);
    context.stroke();
    context.restore();
  });
  context.restore();
}

function drawLabel(prize, center, labelRadius, middleAngle, size) {
  const x = center + Math.cos(middleAngle) * labelRadius;
  const y = center + Math.sin(middleAngle) * labelRadius;
  const isLongLabel = prize.prize === "BETTER LUCK NEXT TIME";
  const fontSize = Math.max(7, Math.min(isLongLabel ? 10 : 15, size * (isLongLabel ? 0.029 : 0.043)));
  const lineHeight = fontSize * 1.16;
  const hasCone = prize.prize === "FREE SOFTY" || prize.prize === "FREE TOPPING";
  const iconOffset = hasCone ? fontSize * 1.35 : 0;

  context.save();
  context.translate(x, y);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `800 ${fontSize}px "DM Sans", sans-serif`;
  context.lineJoin = "round";
  context.lineWidth = Math.max(2, fontSize * 0.24);
  context.strokeStyle = "rgba(255, 255, 255, 0.86)";

  prize.lines.forEach((line, lineIndex) => {
    const lineY = iconOffset + (lineIndex - (prize.lines.length - 1) / 2) * lineHeight;
    context.strokeText(line, 0, lineY);
    context.fillStyle = prize.ink;
    context.fillText(line, 0, lineY);
  });
  if (hasCone) {
    drawMiniCone(0, -fontSize * 1.25, fontSize * 0.82);
  }
  context.restore();
}

function drawMiniCone(x, y, size) {
  context.save();
  context.translate(x, y);
  context.fillStyle = "#f4a8ba";
  context.beginPath();
  context.arc(0, -size * 0.22, size * 0.34, Math.PI, 0);
  context.quadraticCurveTo(size * 0.31, size * 0.1, 0, size * 0.1);
  context.quadraticCurveTo(-size * 0.31, size * 0.1, -size * 0.34, -size * 0.22);
  context.fill();
  context.fillStyle = "#f4bd65";
  context.beginPath();
  context.moveTo(-size * 0.25, size * 0.02);
  context.lineTo(size * 0.25, size * 0.02);
  context.lineTo(0, size * 0.66);
  context.closePath();
  context.fill();
  context.restore();
}
function normalizeIndianMobile(value) {
  const cleaned = value.trim().replace(/[^\d+]/g, "");
  if (!/^(?:(?:\+?91|0))?[6-9]\d{9}$/.test(cleaned)) {
    return null;
  }

  const digits = cleaned.replace(/\D/g, "");
  return digits.length === 12 ? digits.slice(2) : digits.length === 11 ? digits.slice(1) : digits;
}

function validateRegistration() {
  const name = customerNameInput.value.trim().replace(/\s+/g, " ");
  const phone = normalizeIndianMobile(customerPhoneInput.value);
  const validName = name.length >= 2 && /^[\p{L}\p{M}][\p{L}\p{M}\s.'-]{1,59}$/u.test(name);

  customerNameInput.setAttribute("aria-invalid", String(!validName));
  customerPhoneInput.setAttribute("aria-invalid", String(!phone));
  nameError.textContent = validName ? "" : "Please enter your name (at least 2 letters).";
  phoneError.textContent = phone ? "" : "Please enter a valid 10-digit Indian mobile number.";

  if (!validName || !phone) {
    (validName ? customerPhoneInput : customerNameInput).focus();
    return null;
  }

  return { name, phone };
}

function transitionToScreen(nextScreen) {
  const currentScreen = [registrationScreen, wheelScreen, resultScreen]
    .find((screen) => !screen.hidden);
  if (currentScreen === nextScreen) {
    return;
  }

  nextScreen.hidden = false;
  nextScreen.setAttribute("aria-hidden", "false");
  nextScreen.classList.add("is-active");
  currentScreen.classList.remove("is-active");
  currentScreen.classList.add("is-leaving");

  const finishTransition = (event) => {
    if (event.animationName !== "screen-leave") {
      return;
    }

    currentScreen.removeEventListener("animationend", finishTransition);
    currentScreen.hidden = true;
    currentScreen.classList.remove("is-leaving");
    currentScreen.setAttribute("aria-hidden", "true");
  };
  currentScreen.addEventListener("animationend", finishTransition);

  if (nextScreen === wheelScreen) {
    spinButton.disabled = false;
    spinNote.textContent = `${player.name}, your sweet surprise is waiting!`;
    requestAnimationFrame(drawWheel);
  }
}

function chooseWheelSection(prize) {
  const sections = prizes
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => section.prize === prize);
  if (!sections.length) {
    throw new Error("The selected prize is not on the wheel.");
  }

  const selected = sections[Math.floor(Math.random() * sections.length)];
  return { prize: selected.section.prize, sectionIndex: selected.index };
}

function getTargetRotation(sectionIndex) {
  const pointerAngleDegrees = -90;
  const sectionCenterDegrees = -90 + (sectionIndex + 0.5) * (360 / prizes.length);
  const desiredRotation = ((pointerAngleDegrees - sectionCenterDegrees) % 360 + 360) % 360;
  const currentNormalized = ((currentRotation % 360) + 360) % 360;
  const alignmentDelta = (desiredRotation - currentNormalized + 360) % 360;
  const extraTurns = 5 + Math.floor(Math.random() * 3);

  return currentRotation + extraTurns * 360 + alignmentDelta;
}

function animateToSection(sectionIndex) {
  const targetRotation = getTargetRotation(sectionIndex);

  return new Promise((resolve) => {
    const finishSpin = (event) => {
      if (event && (event.target !== canvas || event.propertyName !== "transform")) {
        return;
      }

      window.clearTimeout(fallbackTimer);
      canvas.removeEventListener("transitionend", finishSpin);
      resolve();
    };
    const fallbackTimer = window.setTimeout(finishSpin, spinDuration + 400);

    canvas.addEventListener("transitionend", finishSpin);
    canvas.style.transition = `transform ${spinDuration}ms cubic-bezier(0.12, 0.72, 0.08, 1)`;
    void canvas.offsetWidth;
    canvas.style.transform = `rotate(${targetRotation}deg)`;
    currentRotation = targetRotation;
  });
}

function showCompletedResult(record) {
  savedPrize.textContent = record.prize;
  resultMessage.textContent = "Enjoy your reward from Milky Den! Visit our store and show this winning screen to claim your prize.";
  redemptionNote.textContent = campaignConfig.redemptionConditions[record.prize] || "";
  redemptionNote.hidden = !redemptionNote.textContent;
  transitionToScreen(resultScreen);
}

registrationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  player = validateRegistration();
  if (!player) {
    return;
  }

  storageError.hidden = true;
  const submitButton = registrationForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  try {
    const registration = await registerCustomerWithSupabase(player);
    if (registration.status === "rate_limited") {
      storageError.textContent = "Too many attempts for this mobile number. Please try again later.";
      storageError.hidden = false;
      return;
    }

    if (registration.status === "already_played") {
      player = {
        name: registration.name || player.name,
        phone: registration.normalized_phone || player.phone,
      };
      showSavedSupabaseResult(registration);
      return;
    }

    player = {
      name: registration.name || player.name,
      phone: registration.normalized_phone || player.phone,
    };
    customerNameInput.value = player.name;
    hasSpun = false;
    transitionToScreen(wheelScreen);
  } catch (error) {
    console.error("Unable to register the Milky Den customer with Supabase.", error);
    storageError.textContent = error.message || "Customer registration could not be completed. Please try again.";
    storageError.hidden = false;
  } finally {
    submitButton.disabled = false;
    buttonLabel.textContent = "CONTINUE TO SPIN";
  }
});

customerNameInput.addEventListener("input", () => {
  if (customerNameInput.getAttribute("aria-invalid") === "true") {
    customerNameInput.setAttribute("aria-invalid", "false");
    nameError.textContent = "";
  }
});

customerPhoneInput.addEventListener("input", () => {
  if (customerPhoneInput.getAttribute("aria-invalid") === "true") {
    customerPhoneInput.setAttribute("aria-invalid", "false");
    phoneError.textContent = "";
  }
});

spinButton.addEventListener("click", async () => {
  if (spinButton.disabled || hasSpun || !player) {
    return;
  }

  spinButton.disabled = true;
  buttonLabel.textContent = "SPINNING...";
  spinNote.textContent = "Your sweet surprise is on its way...";

  try {
    const client = await getSupabaseClient();
    const { data, error } = await client.rpc("spin_and_win", {
      p_name: player.name,
      p_phone: player.phone,
    });
    if (error) {
      throw error;
    }
    if (data?.status === "rate_limited") {
      spinButton.disabled = false;
      buttonLabel.textContent = "SPIN NOW";
      spinNote.textContent = "Too many attempts for this mobile number. Please try again later.";
      return;
    }
    if (!data
      || !["completed", "already_played"].includes(data.status)
      || !prizes.some((prize) => prize.prize === data.prize)
      || typeof data.spin_timestamp !== "string") {
      throw new Error("Supabase returned an unexpected spin result.");
    }

    hasSpun = true;
    const completedRecord = {
      name: data.name || player.name,
      phone: data.normalized_phone || player.phone,
      prize: data.prize,
      spunAt: data.spin_timestamp,
      status: "completed",
    };

    if (data.status === "already_played") {
      showCompletedResult(completedRecord);
      return;
    }

    const visualSection = chooseWheelSection(data.prize);
    try {
      await animateToSection(visualSection.sectionIndex);
    } catch (animationError) {
      console.error("Unable to finish the Milky Den wheel animation.", animationError);
    }
    showCompletedResult(completedRecord);
  } catch (error) {
    console.error("Unable to complete the Milky Den Supabase spin.", error);
    spinButton.disabled = false;
    buttonLabel.textContent = "SPIN NOW";
    spinNote.textContent = error.message || "We couldn't complete your spin. Please try again.";
  }
});

if (typeof ResizeObserver === "function") {
  const resizeObserver = new ResizeObserver(drawWheel);
  resizeObserver.observe(wheelDisc);
} else {
  window.addEventListener("resize", drawWheel);
}

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(drawWheel);
}
