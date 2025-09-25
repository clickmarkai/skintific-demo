import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

type Line = { id?: string; product_id?: string; variant_id?: string; product_name: string; qty: number; unit_price_cents: number; image_url?: string; original_price_cents?: number }

const format = (cents: number) => `$${(cents/100).toFixed(2)}`

export default function CartPage() {
  const [lines, setLines] = useState<Line[]>([])
  const [loading, setLoading] = useState(true)
  const [subtotal, setSubtotal] = useState(0)
  const [discount, setDiscount] = useState(0)
  const [total, setTotal] = useState(0)
  const [voucher, setVoucher] = useState<string | null>(null)
  const { user } = useAuth()
  const [method, setMethod] = useState<'bank'|'card'|'qris'>('bank')
  const [bundles, setBundles] = useState<any[]>([])
  const [showBundleModal, setShowBundleModal] = useState(false)
  const [bundleAdding, setBundleAdding] = useState(false)

  const resolveSessionId = async (): Promise<string> => {
    let sid = ''
    // Use the same key as ChatWidget to keep the session consistent
    try { sid = localStorage.getItem('chat_session_id') || '' } catch {}
    if (!sid) {
      try { sid = localStorage.getItem('session_id') || '' } catch {}
    }
    if (user && supabase) {
      try {
        const { data: sessionData } = await supabase
          .from('sessions')
          .select('id')
          .eq('user_id', user.id)
          .order('started_at', { ascending: false })
          .limit(1)
          .single()
        if (sessionData?.id) {
          sid = sessionData.id
          try { localStorage.setItem('chat_session_id', sid); localStorage.setItem('session_id', sid) } catch {}
        }
      } catch {}
    }
    if (!sid) {
      sid = crypto.randomUUID()
      try { localStorage.setItem('chat_session_id', sid); localStorage.setItem('session_id', sid) } catch {}
    }
    return sid
  }

  const callChat = async (payload: any) => {
    if (supabase) {
      const { data, error } = await (supabase as any).functions.invoke('chat', { body: payload })
      if (error) throw error
      return data
    }
    const url = (import.meta as any).env?.VITE_SUPABASE_FUNCTION_URL || ''
    if (!url) throw new Error('Missing VITE_SUPABASE_FUNCTION_URL')
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (!res.ok) throw new Error('Network error')
    return await res.json()
  }

  const load = async () => {
    setLoading(true)
    try {
      const sessionId = await resolveSessionId()
      const data = await callChat({ intent: 'get_cart_info', session_id: sessionId })
      const items = (data?.cart?.items || []) as any[]
      // pull original prices
      let originals: Record<string, number> = {}
      try {
        const ids = Array.from(new Set(items.map((it:any)=> it.product_id).filter(Boolean)))
        if (ids.length && supabase) {
          const { data: rows } = await (supabase as any)
            .from('products').select('id, metadata').in('id', ids)
          for (const r of rows || []) {
            const md = r?.metadata || {}
            const price = typeof md.price === 'number' ? md.price : (typeof md.price_min === 'number' ? md.price_min : 0)
            originals[String(r.id)] = Math.round(Number(price) * 100)
          }
        }
      } catch {}
      setLines(items.map(it => ({ product_name: it.product_name, qty: it.qty || 0, unit_price_cents: it.unit_price_cents || 0, image_url: it.image_url, product_id: it.product_id, variant_id: it.variant_id, original_price_cents: originals[String(it.product_id)] })))
      setSubtotal((data?.cart?.subtotal_cents || 0))
      setDiscount((data?.cart?.discount_cents || 0))
      setTotal((data?.cart?.total_cents ?? data?.cart?.subtotal_cents) || 0)
      setVoucher((data?.cart?.voucher_code || null))
      setBundles(Array.isArray((data as any)?.bundles) ? (data as any).bundles : [])
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    try {
      const url = new URL(window.location.href)
      const q = url.searchParams.get('show_bundles')
      const flag = localStorage.getItem('chat_show_bundles') === '1'
      if ((q === '1' || flag) && bundles.length > 0) {
        setShowBundleModal(true)
        localStorage.removeItem('chat_show_bundles')
      }
    } catch {}
  }, [bundles])

  const updateQty = async (line: Line, qty: number) => {
    const sessionId = await resolveSessionId()
    const data = await callChat({ intent: 'edit_line', session_id: sessionId, product_name: line.product_name, product_id: line.product_id, variant_id: line.variant_id, qty })
    const items = (data?.cart?.items || []) as any[]
    setLines(items.map(it => ({ product_name: it.product_name, qty: it.qty || 0, unit_price_cents: it.unit_price_cents || 0, image_url: it.image_url, product_id: it.product_id, variant_id: it.variant_id })))
    setSubtotal((data?.cart?.subtotal_cents || 0))
    setDiscount((data?.cart?.discount_cents || 0))
    setTotal((data?.cart?.total_cents ?? data?.cart?.subtotal_cents) || 0)
    setVoucher((data?.cart?.voucher_code || null))
    try { localStorage.setItem('cart_updated_at', Date.now().toString()); window.dispatchEvent(new CustomEvent('cart:updated')); } catch {}
  }

  const removeLine = async (line: Line) => {
    const sessionId = await resolveSessionId()
    const data = await callChat({ intent: 'delete_line', session_id: sessionId, product_name: line.product_name, product_id: line.product_id, variant_id: line.variant_id })
    const items = (data?.cart?.items || []) as any[]
    setLines(items.map(it => ({ product_name: it.product_name, qty: it.qty || 0, unit_price_cents: it.unit_price_cents || 0, image_url: it.image_url, product_id: it.product_id, variant_id: it.variant_id })))
    setSubtotal((data?.cart?.subtotal_cents || 0))
    setDiscount((data?.cart?.discount_cents || 0))
    setTotal((data?.cart?.total_cents ?? data?.cart?.subtotal_cents) || 0)
    setVoucher((data?.cart?.voucher_code || null))
    try { localStorage.setItem('cart_updated_at', Date.now().toString()); window.dispatchEvent(new CustomEvent('cart:updated')); } catch {}
  }

  // Listen to chat-driven cart updates and refresh
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === 'cart_updated_at') { load(); } };
    const onCustom = () => load();
    window.addEventListener('storage', onStorage);
    window.addEventListener('cart:updated', onCustom as any);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener('cart:updated', onCustom as any); };
  }, [])

  const addBundle = async (bundle: any) => {
    setBundleAdding(true)
    const sessionId = await resolveSessionId()
    // Add all items from bundle
    for (const it of (bundle.items || [])) {
      await callChat({ intent: 'add_line', session_id: sessionId, product_name: it.name, product_id: it.id, variant_id: it.variant_id, unit_price_cents: it.price_cents || 0, qty: 1 })
    }
    // Reload cart
    const data = await callChat({ intent: 'get_cart_info', session_id: sessionId })
    const items = (data?.cart?.items || []) as any[]
    setLines(items.map(it => ({ product_name: it.product_name, qty: it.qty || 0, unit_price_cents: it.unit_price_cents || 0, image_url: it.image_url, product_id: it.product_id, variant_id: it.variant_id })))
    setSubtotal((data?.cart?.subtotal_cents || 0))
    // Show label using discount delta between original and bundle price
    const original = (bundle.items || []).reduce((s: number, p: any)=> s + (p.price_cents||0), 0)
    const discounted = bundle.price_cents || Math.round(original * 0.9)
    const bundleSavings = Math.max(0, original - discounted)
    setDiscount(d => d + bundleSavings)
    setTotal(t => Math.max(0, t - bundleSavings))
    setShowBundleModal(false)
    setBundleAdding(false)
    try { localStorage.setItem('cart_updated_at', Date.now().toString()); window.dispatchEvent(new CustomEvent('cart:updated')); } catch {}
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Your cart</h1>
      {loading ? (
        <div>Loading…</div>
      ) : lines.length === 0 ? (
        <div>Your cart is empty.</div>
      ) : (
        <div className="space-y-4">
          {lines.map((it, idx) => (
            <div key={idx} className="flex items-center gap-4 p-4 border rounded-lg bg-white">
              {it.image_url && (
                <img
                  src={it.image_url}
                  alt={it.product_name}
                  className="w-16 h-16 rounded object-cover border"
                  loading="lazy"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/placeholder.svg'; }}
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate" title={it.product_name}>{it.product_name}</div>
                <div className="text-sm text-gray-600">
                  {it.original_price_cents && it.original_price_cents > it.unit_price_cents ? (
                    <>
                      <span className="line-through mr-2">{format(it.original_price_cents)}</span>
                      <span className="font-medium">{format(it.unit_price_cents)} each</span>
                      <span className="ml-2 text-green-700">
                        {`${Math.max(1, Math.round(100 - (it.unit_price_cents / it.original_price_cents) * 100))}% off`}
                      </span>
                    </>
                  ) : (
                    <>{format(it.unit_price_cents)} each</>
                  )}
                </div>
                <div className="mt-2 inline-flex items-center rounded-md border bg-white">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => updateQty(it, Math.max(0, it.qty - 1))}>-</Button>
                  <span className="w-8 text-center">{it.qty}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => updateQty(it, it.qty + 1)}>+</Button>
                </div>
              </div>
              <div className="text-right">
                <div className="font-medium">{format(it.unit_price_cents * it.qty)}</div>
                <Button variant="link" className="text-red-600 p-0" onClick={() => removeLine(it)}>Remove</Button>
              </div>
            </div>
          ))}

          <div className="p-4 border rounded-lg bg-white space-y-3">
            <div className="flex justify-between"><span className="text-gray-600">Subtotal</span><span>{format(subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-gray-600">Discount</span><span>-{format(discount)}</span></div>
            <div className="flex justify-between font-semibold"><span>Total</span><span>{format(total)}</span></div>
            {voucher ? (
              <div className="text-sm text-green-700">Voucher applied: <strong>{voucher}</strong></div>
            ) : null}

            <div>
              <div className="text-sm font-medium mb-2">Payment method</div>
              <div className="grid grid-cols-3 gap-2">
                <Button variant={method==='bank'?'default':'outline'} onClick={()=>setMethod('bank')}>Bank</Button>
                <Button variant={method==='card'?'default':'outline'} onClick={()=>setMethod('card')}>Credit Card</Button>
                <Button variant={method==='qris'?'default':'outline'} onClick={()=>setMethod('qris')}>QRIS</Button>
              </div>
            </div>

            <div className="pt-1">
              {method === 'bank' && (
                <div className="text-sm text-gray-700">We support bank transfer (BCA, BNI, Mandiri). You’ll receive virtual account details after placing the order.</div>
              )}
              {method === 'card' && (
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <input className="border rounded px-2 py-2" placeholder="Card holder name" />
                  <input className="border rounded px-2 py-2" placeholder="Card number" />
                  <input className="border rounded px-2 py-2" placeholder="MM/YY" />
                  <input className="border rounded px-2 py-2" placeholder="CVC" />
                </div>
              )}
              {method === 'qris' && (
                <div className="text-sm text-gray-700">Use QRIS to pay from any supported e-wallet or mobile banking app.</div>
              )}
            </div>

            <div className="mt-1 flex gap-2">
              <Button className="bg-primary text-white disabled:opacity-60 disabled:cursor-not-allowed" disabled={lines.length===0} onClick={()=>{
                if(method==='qris') {
                  const sid = localStorage.getItem('session_id') || ''
                  const url = `/payment/qris?amount=${total}&session=${encodeURIComponent(sid)}`
                  window.open(url, '_blank')
                  return
                }
                setShowBundleModal(true)
              }}>Pay now</Button>
            </div>
          </div>
        </div>
      )}
      {showBundleModal && bundles.length > 0 && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[10000]">
          <div className="w-full max-w-lg bg-white rounded-lg p-4 shadow-xl">
            <div className="flex items-center justify-between mb-2">
              <div className="text-lg font-semibold">Bundle and save 10%</div>
              <Button variant="ghost" size="sm" onClick={()=>setShowBundleModal(false)}>Close</Button>
            </div>
            <div className="space-y-3 max-h-[60vh] overflow-auto">
              {bundles.slice(0,2).map((b, idx)=>(
                <div key={idx} className="border rounded p-3">
                  <div className="font-medium">{b.title}</div>
                  <div className="text-sm text-gray-600">{b.description || 'Special pricing when purchased together.'}</div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {(b.items||[]).slice(0,3).map((p: any, i:number)=>(
                      <div key={i} className="text-xs">
                        {p.image_url && <img src={p.image_url} alt={p.name} className="w-full h-16 object-cover rounded border" />}
                        <div className="truncate" title={p.name}>{p.name}</div>
                        <div>{format(p.price_cents||0)}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="text-sm">Bundle price: <span className="font-semibold">{format(b.price_cents || 0)}</span> <span className="ml-2 line-through text-gray-500">{format(b.original_price_cents || 0)}</span> <span className="ml-1 text-green-700">10% off</span></div>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={()=>setShowBundleModal(false)}>Go to cart</Button>
                      <Button onClick={()=>addBundle(b)} disabled={bundleAdding} className="disabled:opacity-60 disabled:cursor-not-allowed">
                        {bundleAdding ? (
                          <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Adding…</span>
                        ) : (
                          'Add to cart'
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


