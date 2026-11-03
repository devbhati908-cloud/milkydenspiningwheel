"use strict";

const prizes = [
  { label: "FREE SOFTY", lines: ["FREE", "SOFTY"], prize: "Free Softy" },
  { label: "10% OFF", lines: ["10%", "OFF"], prize: "10% OFF" },
  { label: "BETTER LUCK NEXT TIME", lines: ["BETTER LUCK", "NEXT TIME"], prize: "Better Luck Next Time" },
  { label: "20% OFF", lines: ["20%", "OFF"], prize: "20% OFF" },
  { label: "FREE TOPPING", lines: ["FREE", "TOPPING"], prize: "Free Topping" },
  { label: "10% OFF", lines: ["10%", "OFF"], prize: "10% OFF" },
  { label: "BETTER LUCK NEXT TIME", lines: ["BETTER LUCK", "NEXT TIME"], prize: "Better Luck Next Time" },
  { label: "20% OFF", lines: ["20%", "OFF"], prize: "20% OFF" },
];

const colors = [
  { fill: "#f6b8c7", text: "#632f43" },
  { fill: "#ffdc86", text: "#613c30" },
  { fill: "#fff1d2", text: "#713d4d" },
  { fill: "#d77d91", text: "#fffaf3" },
  { fill: "#f7c4a4", text: "#663d3e" },
  { fill: "#f4d671", text: "#5e3b2e" },
  { fill: "#f4dce0", text: "#713d4d" },
  { fill: "#ed9eae", text: "#633347" },
];

const prizeWeights = [
  { prize: "Free Softy", weight: 2 },
  { prize: "Free Topping", weight: 3 },
  { prize: "20% OFF", weight: 15 },
  { prize: "10% OFF", weight: 80 },
];

const canvas = document.querySelector("#prizeWheel");
const wheelFrame = document.querySelector("#wheelFrame");
const spinButton = document.querySelector("#spinButton");
const buttonLabel = document.querySelector(".button-label");
const spinNote = document.querySelector("#spinNote");
const resultCard = document.querySelector("#resultCard");
const resultKicker = document.querySelector("#resultKicker");
const resultMessage = document.querySelector("#resultMessage");
const resultDetail = document.querySelector("#resultDetail");
const context = canvas.getContext("2d");
const sliceAngle = (Math.PI * 2) / prizes.length;
const spinDuration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1400 : 5200;
let currentRotation = 0;
let resizeObserver;

function drawWheel() {
  const bounds = wheelFrame.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  const size = Math.max(1, bounds.width - 16);

  canvas.width = Math.round(size * pixelRatio);
  canvas.height = Math.round(size * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  const center = size / 2;
  const radius = size / 2;
  const labelRadius = radius * 0.66;

  context.clearRect(0, 0, size, size);

  prizes.forEach((prize, index) => {
    const startAngle = -Math.PI / 2 + index * sliceAngle;
    const endAngle = startAngle + sliceAngle;
    const middleAngle = startAngle + sliceAngle / 2;

    context.beginPath();
    context.moveTo(center, center);
    context.arc(center, center, radius, startAngle, endAngle);
    context.closePath();
    context.fillStyle = colors[index].fill;
    context.fill();
    context.lineWidth = Math.max(1.5, size * 0.006);
    context.strokeStyle = "rgba(255, 253, 249, 0.95)";
    context.stroke();

    context.save();
    context.translate(center, center);
    context.beginPath();
    context.moveTo(0, 0);
    context.arc(0, 0, radius, startAngle, endAngle);
    context.closePath();
    context.clip();
    context.rotate(middleAngle);
    context.translate(labelRadius, 0);
    context.rotate(Math.PI / 2);

    if (middleAngle > Math.PI / 2 && middleAngle < (Math.PI * 3) / 2) {
      context.rotate(Math.PI);
    }

    context.fillStyle = colors[index].text;
    const isLongLabel = prize.prize === "Better Luck Next Time";
    const baseFontSize = Math.max(7, Math.min(13, radius * (isLongLabel ? 0.052 : 0.075)));
    const availableWidth = 2 * labelRadius * Math.sin(sliceAngle / 2) - baseFontSize * 0.8;
    let fontSize = baseFontSize;
    context.font = `800 ${fontSize}px "DM Sans", sans-serif`;
    const widestLine = Math.max(...prize.lines.map((line) => context.measureText(line).width));
    if (widestLine > availableWidth) {
      fontSize *= availableWidth / widestLine;
      context.font = `800 ${fontSize}px "DM Sans", sans-serif`;
    }

    context.textAlign = "center";
    context.textBaseline = "middle";
    const lineHeight = fontSize * 1.12;
    const firstLineY = -((prize.lines.length - 1) * lineHeight) / 2;

    prize.lines.forEach((line, lineIndex) => {
      context.fillText(line, 0, firstLineY + lineIndex * lineHeight);
    });

    context.restore();
  });

  context.beginPath();
  context.arc(center, center, radius - 1, 0, Math.PI * 2);
  context.lineWidth = Math.max(2, size * 0.012);
  context.strokeStyle = "#fffdf9";
  context.stroke();
}

function selectPrize() {
  const roll = Math.random() * 100;
  let cumulativeWeight = 0;
  let selectedPrize = prizeWeights[prizeWeights.length - 1].prize;

  for (const entry of prizeWeights) {
    cumulativeWeight += entry.weight;
    if (roll < cumulativeWeight) {
      selectedPrize = entry.prize;
      break;
    }
  }

  const matchingSections = prizes
    .map((prize, index) => ({ prize, index }))
    .filter(({ prize }) => prize.prize === selectedPrize);
  const selectedSection = matchingSections[Math.floor(Math.random() * matchingSections.length)];

  return { ...selectedSection.prize, sectionIndex: selectedSection.index };
}

function getTargetRotation(sectionIndex) {
  const sectionCenterDegrees = (sectionIndex + 0.5) * (360 / prizes.length);
  const desiredRotation = ((360 - sectionCenterDegrees) % 360 + 360) % 360;
  const currentNormalized = ((currentRotation % 360) + 360) % 360;
  const alignmentDelta = (desiredRotation - currentNormalized + 360) % 360;
  const extraTurns = 5 + Math.floor(Math.random() * 3);

  return currentRotation + extraTurns * 360 + alignmentDelta;
}

function showResult(prize) {
  resultCard.hidden = false;
  resultKicker.textContent = prize.prize === "Free Softy" || prize.prize === "Free Topping"
    ? "SCOOP! YOU WON"
    : "YOUR SPIN RESULT";
  resultMessage.textContent = prize.prize === "Better Luck Next Time"
    ? "Better luck next time!"
    : `You won ${prize.prize}!`;
  resultDetail.textContent = "Thanks for playing with Milky Den!";
  spinNote.textContent = "Your sweet surprise is ready!";
}

function spin() {
  if (spinButton.disabled) {
    return;
  }

  spinButton.disabled = true;
  buttonLabel.textContent = "SPINNING...";
  spinNote.textContent = "Your sweet surprise is on its way...";
  resultCard.hidden = true;

  const selectedPrize = selectPrize();
  const targetRotation = getTargetRotation(selectedPrize.sectionIndex);

  canvas.style.transition = `transform ${spinDuration}ms cubic-bezier(0.12, 0.72, 0.08, 1)`;
  void canvas.offsetWidth;
  canvas.style.transform = `rotate(${targetRotation}deg)`;
  currentRotation = targetRotation;
  let spinFinished = false;

  const finishSpin = (event) => {
    if (spinFinished || (event && event.propertyName !== "transform")) {
      return;
    }

    spinFinished = true;
    canvas.removeEventListener("transitionend", finishSpin);
    showResult(selectedPrize);
    buttonLabel.textContent = "SPIN NOW";
    spinButton.disabled = false;
  };

  canvas.addEventListener("transitionend", finishSpin);
  window.setTimeout(() => {
    finishSpin();
  }, spinDuration + 400);
}

spinButton.addEventListener("click", spin);

if (typeof ResizeObserver === "function") {
  resizeObserver = new ResizeObserver(drawWheel);
  resizeObserver.observe(wheelFrame);
} else {
  window.addEventListener("resize", drawWheel);
}

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(drawWheel);
}

drawWheel();
