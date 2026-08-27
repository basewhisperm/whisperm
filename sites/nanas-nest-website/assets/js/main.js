// Nana's Nest — small progressive-enhancement script (no dependencies)
(function () {
  var toggle = document.querySelector(".nav-toggle");
  var body = document.body;

  if (toggle) {
    toggle.addEventListener("click", function () {
      var isOpen = body.classList.toggle("nav-open");
      toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });
  }

  // Close mobile nav when a link is chosen
  document.querySelectorAll(".main-nav a").forEach(function (link) {
    link.addEventListener("click", function () {
      body.classList.remove("nav-open");
      if (toggle) toggle.setAttribute("aria-expanded", "false");
    });
  });

  // Set current year in footer
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

  // Basic client-side validation state for the inquiry form (progressive
  // enhancement only — server-side handling should validate again)
  var form = document.querySelector(".inquiry-form");
  if (form) {
    form.addEventListener("submit", function (e) {
      var required = form.querySelectorAll("[required]");
      var valid = true;
      required.forEach(function (field) {
        if (!field.value.trim()) valid = false;
      });
      if (!valid) {
        e.preventDefault();
        var note = form.querySelector(".form-status");
        if (note) {
          note.textContent = "Please fill in the highlighted fields so we can follow up.";
          note.style.display = "block";
        }
      }
    });
  }
})();
