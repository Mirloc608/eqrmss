// ============================================================================
// EQRMSS Actor Sheet — Inventory Helper
// ============================================================================
//
// Responsibilities:
// - Bind inventory UI interactions
// - Provide item edit / delete behavior
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

        // ------------------------------------------------------------
        // Consolidate stacks (2026-10-16): merge matching inventory
        // items into fewer entries.
        // ------------------------------------------------------------
        html.querySelectorAll(".item-consolidate").forEach(btn => {
            btn.addEventListener("click", async ev => {
                ev.preventDefault();
                try {
                    const { consolidateInventory } = await import("../../../utils/inventory/inventory-stacking.js");
                    const { merged, removed } = await consolidateInventory(this.actor);
                    if (merged > 0) {
                        ui.notifications.info(`EQRMSS | Consolidated ${merged} stack${merged === 1 ? "" : "s"} (${removed} entries removed).`);
                    } else {
                        ui.notifications.info("EQRMSS | Nothing to consolidate.");
                    }
                } catch (e) {
                    console.warn("EQRMSS | Consolidate failed", e);
                    ui.notifications.warn("EQRMSS | Consolidation failed. See console.");
                }
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
