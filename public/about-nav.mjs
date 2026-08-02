// The left-hand section nav on the about pages, kept in step with what you are
// reading. Without this the nav is still a working list of links; this only
// marks which one you are in, so it reads as a position rather than a menu.
//
// The page works with scripting off. Nothing here creates content.

const crumbs = [...document.querySelectorAll(".about-crumbs a")];
const sections = crumbs
  .map((a) => document.querySelector(a.getAttribute("href")))
  .filter(Boolean);

if (sections.length && "IntersectionObserver" in window) {
  const markCurrent = (section) => {
    for (const a of crumbs) {
      const isHere = a.getAttribute("href") === `#${section.id}`;
      if (isHere) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    }
  };

  // Whichever section covers the reading line near the top of the viewport is
  // the one you are in. Several can intersect at once, so pick the topmost of
  // those still crossing that line.
  const visible = new Set();
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) visible.add(entry.target);
      else visible.delete(entry.target);
    }
    const here = sections.find((s) => visible.has(s));
    if (here) markCurrent(here);
  }, { rootMargin: "-10% 0px -70% 0px", threshold: 0 });

  for (const section of sections) observer.observe(section);
  markCurrent(sections[0]);
}
