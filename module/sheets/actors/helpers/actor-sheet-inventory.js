// ============================================================================
// EQRMSS Actor Sheet — Inventory Helper
// ============================================================================
//
// Responsibilities:
// - Bind inventory UI interactions
// - Provide item edit / delete / toggle-worn behavior
// - Normalize inventory item blocks
// - Support drag/drop (optional future expansion)
// - Keep logic out of the main sheet class
//
// ============================================================================

export class EQRMSSActorInventoryHelper {

    constructor(sheet) {
        this.sheet  = sheet;
        this.actor  = sheet.actor;
        this.system = sheet.actor.system;
    }

    // =========================================================================
    // ACTIVATE INVENTORY INTERACTIONS
    // =========================================================================
    activate() {

        const html = this.sheet.element;
        if (!html) return;

        // ------------------------------------------------------------
        // Edit item
        // ------------------------------------------------------------
        html.querySelectorAll(".item-edit").forEach(btn => {
            btn.addEventListener("click", ev => {
                const id = ev.currentTarget.dataset.itemId;
                const item = this.actor.items.get(id);
                if (item) item.sheet.render(true);
            });
        });

        // ------------------------------------------------------------
        // Delete item
        // ------------------------------------------------------------
        html.querySelectorAll(".item-delete").forEach(btn => {
            btn.addEventListener("click", ev => {
                const id = ev.currentTarget.dataset.itemId;
                if (id) this.actor.deleteEmbeddedDocuments("Item", [id]);
            });
        });

        // ------------------------------------------------------------
        // Toggle worn/equipped
        // ------------------------------------------------------------
        html.querySelectorAll(".item-toggle-worn").forEach(btn => {
            btn.addEventListener("click", ev => {
                const id = ev.currentTarget.dataset.itemId;
                const item = this.actor.items.get(id);
                if (!item) return;

                const newState = !item.system.worn;
                item.update({ "system.worn": newState });
            });
        });

        // ------------------------------------------------------------
        // Quantity adjust (optional future expansion)
        // ------------------------------------------------------------
        html.querySelectorAll(".item-qty-adjust").forEach(btn => {
            btn.addEventListener("click", ev => {
                const id = ev.currentTarget.dataset.itemId;
                const delta = Number(ev.currentTarget.dataset.delta ?? 0);

                const item = this.actor.items.get(id);
                if (!item) return;

                const current = Number(item.system.quantity ?? 0);
                const next = Math.max(0, current + delta);

                item.update({ "system.quantity": next });
            });
        });
    }

    // =========================================================================
    // NORMALIZE INVENTORY BLOCKS (optional for future use)
    // =========================================================================
    buildInventoryContext() {

        const items = this.actor.items.contents;

        return {
            weapons:        items.filter(i => i.type === "weapon"),
            armor:          items.filter(i => i.type === "armor"),
            herbs:          items.filter(i => i.type === "herb_or_poison"),
            transport:      items.filter(i => i.type === "transport"),
            consumables:    items.filter(i => i.type === "consumable"),
            shields:        items.filter(i => i.type === "shield"),
            jewelry:        items.filter(i => i.type === "jewelry"),
            general:        items.filter(i => i.type === "item")
        };
    }
}
