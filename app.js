// WiseSplit site interactions: mobile nav, copy buttons, active doc section.
(function () {
  var toggle = document.getElementById('navToggle');
  var links = document.getElementById('navLinks');
  if (toggle && links) {
    var setOpen = function (open) {
      links.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    toggle.addEventListener('click', function () { setOpen(!links.classList.contains('open')); });
    // Close the mobile menu after tapping a link or pressing Escape.
    links.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { setOpen(false); });
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
  }

  // Add copy buttons to code blocks.
  document.querySelectorAll('pre').forEach(function (pre) {
    var btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.type = 'button';
    btn.textContent = 'Copy';
    btn.addEventListener('click', function () {
      var code = pre.querySelector('code');
      navigator.clipboard.writeText((code || pre).textContent.trim()).then(function () {
        btn.textContent = 'Copied!';
        setTimeout(function () { btn.textContent = 'Copy'; }, 1500);
      });
    });
    pre.appendChild(btn);
    pre.setAttribute('role', 'region');
    pre.setAttribute('aria-label', 'Code block');
  });

  // Highlight active section in docs sidebar.
  var sideLinks = document.querySelectorAll('.docs-side a');
  if (sideLinks.length) {
    var sections = Array.prototype.map.call(sideLinks, function (a) {
      return document.getElementById(a.getAttribute('href').slice(1));
    });
    var onScroll = function () {
      var pos = window.scrollY + 120;
      var current = -1;
      sections.forEach(function (sec, i) { if (sec && sec.offsetTop <= pos) current = i; });
      sideLinks.forEach(function (a, i) { a.classList.toggle('active', i === current); });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
})();
