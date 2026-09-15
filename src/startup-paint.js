// Paint the cached wallpaper preview before the full theme bootstrap runs.
try {
  var root = document.documentElement;
  var hasStoredBackground = localStorage.getItem("has_idb_bg") === "true";
  var preview = localStorage.getItem("lowResBg");

  if (
    hasStoredBackground &&
    typeof preview === "string" &&
    preview.startsWith("data:image/")
  ) {
    root.classList.add("ydd-custom-bg-pending");
    root.style.backgroundImage =
      'linear-gradient(rgba(0,0,0,.25), rgba(0,0,0,.25)), url("' +
      preview.replace(/"/g, "%22") +
      '")';
    root.style.backgroundSize = "cover";
    root.style.backgroundPosition = "center";
    root.style.backgroundRepeat = "no-repeat";
    window.__yddStartupPreviewApplied = true;
  }
} catch (error) {
}
