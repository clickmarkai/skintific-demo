import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { supabase, Product } from "@/lib/supabase";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { ShoppingCart, Star, Truck, Handshake, Headphones, Fingerprint } from "lucide-react";

const ProductGrid = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) {
          setError(error.message);
        } else {
          setProducts(data || []);
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, []);

  if (loading) {
    return (
      <section className="bg-white py-16">
        <div className="container mx-auto px-4">
          <div className="text-center">
            <p className="text-gray-600">Loading products...</p>
          </div>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="bg-white py-16">
        <div className="container mx-auto px-4">
          <div className="text-center">
            <p className="text-red-600">Error loading products: {error}</p>
          </div>
        </div>
      </section>
    );
  }

  const formatPriceIDR = (value: number | string | null | undefined) => {
    if (value === null || value === undefined) return "Rp 0,00";
    const num = typeof value === "string" ? parseFloat(value) : value;
    if (Number.isNaN(num as number)) return "Rp 0,00";
    return `Rp ${(num as number).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <section className="bg-white py-10">
      <div className="container mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-semibold tracking-wide text-black">BEST SELLERS</h2>
        </div>
        <Carousel opts={{ dragFree: true, align: 'start' }}>
          <CarouselContent>
            {products.map((product) => (
              <CarouselItem key={product.id} className="basis-1/2 md:basis-1/3 lg:basis-1/5">
                <div className="text-left h-full flex flex-col">
                  <div className="bg-gray-100 rounded-lg p-4 mb-3">
                    <div className="w-full aspect-square bg-white rounded-lg overflow-hidden">
                      {product.metadata.image_url ? (
                        <img 
                          src={product.metadata.image_url} 
                          alt={product.metadata.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-gray-400 text-sm flex items-center justify-center h-full">Product Image</span>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col">
                    <h3 className="font-semibold text-sm md:text-base text-black line-clamp-2 mb-1">{product.metadata.title}</h3>
                    <p className="text-gray-900 font-semibold mb-1">{formatPriceIDR(product.metadata.price as any)}</p>
                    <div className="flex items-center gap-1 mb-2">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star key={i} className="h-4 w-4 fill-black text-black" />
                      ))}
                      <span className="text-xs text-gray-500 ml-1">5.0</span>
                    </div>
                    <div className="mb-3 flex gap-2">
                      <span className="w-4 h-4 rounded-full bg-neutral-200 border" />
                      <span className="w-4 h-4 rounded-full bg-rose-300 border" />
                      <span className="w-4 h-4 rounded-full bg-amber-300 border" />
                    </div>
                  </div>
                  <Button className="w-full bg-black hover:bg-black text-white mt-auto">
                    <ShoppingCart className="h-4 w-4 mr-2" />
                    Add To cart
                  </Button>
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className="bg-white shadow" />
          <CarouselNext className="bg-white shadow" />
        </Carousel>
        {/* Features bar following Best Sellers */}
        <div className="mt-10 md:mt-14">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <Truck className="h-7 w-7 mx-auto text-black" />
              <div className="mt-3 font-semibold text-black tracking-wide">FREE SHIPPING</div>
              <div className="text-sm text-gray-600">5-12 Business days shipping</div>
            </div>
            <div>
              <Handshake className="h-7 w-7 mx-auto text-black" />
              <div className="mt-3 font-semibold text-black tracking-wide">15 DAYS WARRANTY</div>
              <div className="text-sm text-gray-600">Shop risk-free within 15 days</div>
            </div>
            <div>
              <Headphones className="h-7 w-7 mx-auto text-black" />
              <div className="mt-3 font-semibold text-black tracking-wide">SUPPORT 24/7</div>
              <div className="text-sm text-gray-600">Contact us 24 hours</div>
            </div>
            <div>
              <Fingerprint className="h-7 w-7 mx-auto text-black" />
              <div className="mt-3 font-semibold text-black tracking-wide">100% PAYMENT SECURE</div>
              <div className="text-sm text-gray-600">Safe & Secure Payment</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ProductGrid;