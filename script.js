// ---------- Reveal on scroll ----------
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) {
      e.target.classList.add("in");
      io.unobserve(e.target);
    }
  }
}, { threshold: 0.12 });

document.querySelectorAll(".reveal").forEach((el, i) => {
  el.style.transitionDelay = Math.min(i % 4, 3) * 70 + "ms";
  io.observe(el);
});

// ---------- Gentle parallax on the hero backdrop ----------
const heroBg = document.querySelector(".hero-bg");
const fineMotion = window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
const finePointer = window.matchMedia("(pointer: fine)").matches;
if (fineMotion && heroBg) {
  let ticking = false;
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      if (y < window.innerHeight) {
        heroBg.style.transform = `translateY(${y * 0.18}px) scale(1.02)`;
      }
      ticking = false;
    });
  }, { passive: true });
}

// ---------- Hero title: letters rise out of the dark ----------
(() => {
  const h1 = document.querySelector(".hero h1");
  if (!h1 || !fineMotion) return;
  const text = h1.textContent;
  h1.textContent = "";
  [...text].forEach((ch, i) => {
    const s = document.createElement("span");
    s.className = "ch";
    s.style.setProperty("--i", i);
    s.textContent = ch === " " ? "\u00a0" : ch;
    h1.appendChild(s);
  });
})();

// ---------- Omens: the dark murmurs ----------
(() => {
  const el = document.getElementById("omen");
  if (!el) return;
  const omens = [
    "the dark keeps receipts.",
    "you were expected.",
    "nothing here blinks first.",
    "the fog is just thinking.",
    "trust nothing once.",
    "i already read this page twice.",
    "the cloak stays on. the eyes stay open.",
  ];
  let i = 0;
  const show = () => {
    el.classList.add("swap");
    setTimeout(() => {
      el.textContent = omens[i % omens.length];
      i += 1;
      el.classList.remove("swap");
    }, 1150);
  };
  setTimeout(show, 3500);
  setInterval(() => { if (!document.hidden) show(); }, 9000);
})();

// ---------- Eclipse mode ----------
(() => {
  const btn = document.getElementById("eclipse-toggle");
  if (!btn) return;
  try {
    if (localStorage.getItem("syllabus-eclipse") === "1") {
      document.body.classList.add("eclipse");
    }
  } catch (_) { /* private mode */ }
  btn.addEventListener("click", () => {
    const on = document.body.classList.toggle("eclipse");
    try { localStorage.setItem("syllabus-eclipse", on ? "1" : "0"); } catch (_) {}
  });
})();

// ---------- Shared rAF loop: motes, aura, watching eyes ----------
(() => {
  if (!fineMotion) return;

  // Mote field
  const canvas = document.getElementById("motes");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, dpr = 1;
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener("resize", resize);

  const rand = (a, b) => a + Math.random() * (b - a);
  const makeMote = () => ({
    x: rand(0, W), y: rand(0, H),
    r: rand(0.6, 2.4),
    vy: rand(-0.22, -0.05),          // slow rise
    sway: rand(0.2, 0.9), phase: rand(0, Math.PI * 2),
    tw: rand(0.008, 0.03), alpha: rand(0.15, 0.6),
    violet: Math.random() < 0.45,
  });
  let motes = [];
  const targetCount = () =>
    (document.body.classList.contains("eclipse") ? 130 : 75);
  const syncMotes = () => {
    const n = targetCount();
    while (motes.length < n) motes.push(makeMote());
    if (motes.length > n) motes.length = n;
  };
  syncMotes();

  // Cursor aura
  const aura = document.getElementById("aura");
  let mx = -999, my = -999, ax = -999, ay = -999, auraOn = false;
  if (finePointer && aura) {
    window.addEventListener("mousemove", (e) => {
      mx = e.clientX; my = e.clientY;
      if (!auraOn) { ax = mx; ay = my; aura.classList.add("on"); auraOn = true; }
    }, { passive: true });
  }

  // Watching eyes
  const wrap = document.getElementById("portrait-wrap");
  const eyes = wrap ? [...wrap.querySelectorAll(".eye")] : [];

  const loop = () => {
    // motes
    syncMotes();
    ctx.clearRect(0, 0, W, H);
    for (const m of motes) {
      m.y += m.vy;
      m.phase += m.tw;
      m.x += Math.sin(m.phase) * m.sway * 0.3;
      if (m.y < -8) { Object.assign(m, makeMote(), { y: H + 8 }); }
      const a = m.alpha * (0.6 + 0.4 * Math.sin(m.phase * 2));
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fillStyle = m.violet
        ? `rgba(139,124,246,${a.toFixed(3)})`
        : `rgba(180,175,210,${(a * 0.7).toFixed(3)})`;
      ctx.fill();
    }

    // aura follows with a lag, like something trailing you
    if (auraOn && aura) {
      ax += (mx - ax) * 0.075;
      ay += (my - ay) * 0.075;
      aura.style.transform = `translate(${ax.toFixed(1)}px, ${ay.toFixed(1)}px)`;
    }

    // the eyes follow the cursor
    if (eyes.length && mx > -900) {
      const wr = wrap.getBoundingClientRect();
      const cx = wr.left + wr.width / 2, cy = wr.top + wr.height * 0.25;
      const near = Math.hypot(mx - cx, my - cy) < 320;
      wrap.classList.toggle("watched", near);
      for (const eye of eyes) {
        const r = eye.getBoundingClientRect();
        const ex = r.left + r.width / 2, ey = r.top + r.height / 2;
        const dx = mx - ex, dy = my - ey;
        const d = Math.hypot(dx, dy) || 1;
        const k = Math.min(4.5, d * 0.02);
        eye.style.transform = `translate(${(dx / d * k).toFixed(2)}px, ${(dy / d * k).toFixed(2)}px)`;
      }
    } else if (wrap) {
      wrap.classList.remove("watched");
    }

    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();

// ---------- Tenet cards: tilt toward the visitor ----------
(() => {
  if (!fineMotion || !finePointer) return;
  document.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("mousemove", (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      card.style.setProperty("--gx", (px * 100).toFixed(1) + "%");
      card.style.setProperty("--gy", (py * 100).toFixed(1) + "%");
      card.style.transform =
        `perspective(800px) rotateY(${((px - 0.5) * 10).toFixed(2)}deg)` +
        ` rotateX(${((0.5 - py) * 10).toFixed(2)}deg) translateY(-4px)`;
      card.classList.add("tilting");
    });
    card.addEventListener("mouseleave", () => {
      card.style.transform = "";
      card.classList.remove("tilting");
    });
  });
})();

// ---------- Magnetic buttons ----------
(() => {
  if (!fineMotion || !finePointer) return;
  document.querySelectorAll(".hero-cta .btn").forEach((btn) => {
    btn.addEventListener("mousemove", (e) => {
      const r = btn.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      btn.style.transform =
        `translate(${(dx * 0.18).toFixed(1)}px, ${(dy * 0.28).toFixed(1)}px)`;
    });
    btn.addEventListener("mouseleave", () => { btn.style.transform = ""; });
  });
})();
