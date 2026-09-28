// Reveal on scroll
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

// Gentle parallax on the hero backdrop
const heroBg = document.querySelector(".hero-bg");
const fine = window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
if (fine && heroBg) {
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
