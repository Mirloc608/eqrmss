// ============================================================
// EQRMSS — Catalog drag source (2026-10-26)
// ============================================================
// Player-guide journal cards carry data-catalog-id + draggable.
// One delegated dragstart listener turns a card drag into the
// payload the actor sheet's drop handler understands:
//   { type: "EQRMSSCatalogItem", id: <catalog id> }
// The sheet resolves it through addCatalogItemToActor — the same
// path as the catalog picker (lands in the pack, stacks when
// possible).
// ============================================================

let _catalogDragBound = false;

export function registerCatalogDrag() {
    if (_catalogDragBound) return;
    _catalogDragBound = true;
    document.addEventListener("dragstart", (event) => {
        const el = event.target?.closest?.("[data-catalog-id]");
        if (!el) return;
        const id = el.getAttribute("data-catalog-id");
        if (!id || !event.dataTransfer) return;
        try {
            event.dataTransfer.setData("text/plain", JSON.stringify({ type: "EQRMSSCatalogItem", id }));
            event.dataTransfer.effectAllowed = "copy";
        } catch (e) { /* not a draggable payload target */ }
    });
    console.log("EQRMSS | Catalog drag source registered");
}
