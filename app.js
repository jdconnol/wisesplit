// WiseSplit site interactions: mobile nav, copy buttons, active doc section.
(function () {
  var toggle = document.getElementById('navToggle');
  var links = document.getElementById('navLinks');
  if (toggle && links) {
    toggle.addEventListener('click', function () { links.classList.toggle('open'); });
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
