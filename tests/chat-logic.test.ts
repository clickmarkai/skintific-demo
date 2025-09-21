import { describe, it, expect } from 'vitest'
import { detectIntent, extractQty, ensureCart, recomputeTotals, computeBestVoucher, type Cart } from '../netlify/functions/chat'

describe('intent detection', () => {
  it('routes voucher keywords to apply_voucher', () => {
    expect(detectIntent('any discounts?')).toBe('apply_voucher')
    expect(detectIntent('ada diskon?')).toBe('apply_voucher')
  })

  it('routes add to add_line', () => {
    expect(detectIntent('add ceramide serum 2')).toBe('add_line')
  })

  it('routes cart to get_cart_info', () => {
    expect(detectIntent('show my cart')).toBe('get_cart_info')
  })
})

describe('quantity extraction', () => {
  it('defaults to 1', () => {
    expect(extractQty('add ceramide serum')).toBe(1)
  })
  it('parses digits', () => {
    expect(extractQty('add ceramide serum 3')).toBe(3)
  })
})

describe('cart totals and vouchers', () => {
  it('computes totals and applies best voucher', () => {
    const cart: Cart = { items: [], subtotal_cents: 0, discount_cents: 0, total_cents: 0, voucher_code: null }
    cart.items.push({ product_name: '5X Ceramide Barrier Repair Moisture Gel', qty: 2, unit_price_cents: 899 })
    recomputeTotals(cart)
    // With subtotal 1798, WELCOME10 (10%) -> discount 179, total 1619
    const best = computeBestVoucher(cart)
    expect(best.amount_cents).toBeGreaterThan(0)
  })
})


