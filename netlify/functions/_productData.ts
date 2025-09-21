export type Product = {
  name: string;
  price_cents: number;
  image_url?: string;
  benefits?: string[];
  ingredients?: string[];
  tags?: string[];
};

export const PRODUCTS: Product[] = [
  {
    name: "5X Ceramide Barrier Repair Moisture Gel",
    price_cents: 899,
    image_url: "https://images.unsplash.com/photo-1601004890684-d8cbf643f5f2?w=400&q=80",
    benefits: ["Repairs skin barrier", "Soothes redness", "Hydrates"],
    ingredients: ["Ceramides", "Hyaluronic Acid", "Centella"],
    tags: ["ceramide", "moisturizer"],
  },
  {
    name: "10% Niacinamide Brightening Serum",
    price_cents: 1099,
    image_url: "https://images.unsplash.com/photo-1585386959984-a4155223168f?w=400&q=80",
    benefits: ["Brightens", "Evens tone", "Minimizes pores"],
    ingredients: ["Niacinamide", "Zinc"],
    tags: ["niacinamide", "serum"],
  },
  {
    name: "5X Ceramide Barrier Repair Serum",
    price_cents: 1299,
    image_url: "https://images.unsplash.com/photo-1505575972945-28021aaeea3b?w=400&q=80",
    benefits: ["Strengthens barrier", "Smooths texture"],
    ingredients: ["Ceramides", "Marine Collagen"],
    tags: ["ceramide", "serum"],
  },
];

export function searchProducts(query: string, limit = 6): Product[] {
  const q = query.toLowerCase();
  return PRODUCTS.filter((p) =>
    p.name.toLowerCase().includes(q) || (p.tags || []).some((t) => q.includes(t))
  ).slice(0, limit);
}


