-- Extend the existing ledger to support batch-level sale deductions.
-- Existing receipt movements and their unique receipt references are preserved.

alter table public.stock_movements
  alter column receipt_item_id drop not null,
  add column sale_item_id uuid,
  add column sale_cost_per_base_unit numeric(24,12),
  drop constraint stock_movements_movement_type_check,
  drop constraint stock_movements_base_quantity_delta_check;

alter table public.stock_movements
  add constraint stock_movements_movement_type_check check (
    movement_type in ('receipt', 'sale')
  ),
  add constraint stock_movements_source_and_quantity_check check (
    (
      movement_type = 'receipt'
      and receipt_item_id is not null
      and sale_item_id is null
      and sale_cost_per_base_unit is null
      and base_quantity_delta > 0
      and base_quantity_delta < 1000000000000
    )
    or
    (
      movement_type = 'sale'
      and receipt_item_id is null
      and sale_item_id is not null
      and sale_cost_per_base_unit is not null
      and sale_cost_per_base_unit >= 0
      and sale_cost_per_base_unit < 1000000000000
      and base_quantity_delta < 0
      and base_quantity_delta > -1000000000000
    )
  ),
  add constraint stock_movements_sale_item_fkey
    foreign key (pharmacy_id, sale_item_id, product_id)
    references public.sale_items(pharmacy_id, id, product_id)
    on delete restrict,
  add constraint stock_movements_sale_item_batch_key
    unique (pharmacy_id, sale_item_id, batch_id);

-- RLS and revoked direct application access remain in place.
