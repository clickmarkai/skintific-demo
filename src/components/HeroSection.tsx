import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { supabase, Product } from "@/lib/supabase";

const HeroSection = () => {
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchFeaturedProducts = async () => {
      try {
        // Get the first 4 products as featured products
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(4);

        if (error) {
          console.error('Error fetching featured products:', error);
        } else {
          setFeaturedProducts(data || []);
        }
      } catch (err: any) {
        console.error('Error fetching featured products:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchFeaturedProducts();
  }, []);

  if (loading) {
    return (
      <section className="bg-white py-8">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">
              Best sellers
            </h2>
          </div>
          <div className="text-center">
            <p className="text-gray-600">Loading featured products...</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-white py-8">
      <div className="container mx-auto px-4">
        {/* Best Sellers Section */}
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">
            Best sellers
          </h2>
        </div>

        {/* Hero Products Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-16">
          {featuredProducts.map((product) => (
            <div key={product.id} className="text-center flex flex-col h-full">
              <div className="bg-gray-100 rounded-lg p-8 mb-4">
                <div className="w-32 h-32 bg-white rounded-lg mx-auto mb-4 flex items-center justify-center overflow-hidden">
                  {product.metadata.image_url ? (
                    <img 
                      src={product.metadata.image_url} 
                      alt={product.metadata.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-gray-400 text-sm">Product Image</span>
                  )}
                </div>
              </div>
              <h3 className="font-semibold text-lg mb-2 text-black">{product.metadata.title}</h3>
              <p className="text-gray-600 mb-2">${product.metadata.price}</p>
              <p className="text-sm text-gray-500 mb-4">
                {Math.floor(Math.random() * 50) + 1} reviews
              </p>
              <div className="flex justify-center gap-2 mb-4">
                {product.metadata.variant_title ? (
                  <span className="bg-gray-200 px-3 py-1 rounded text-sm">
                    {product.metadata.variant_title}
                  </span>
                ) : (
                  <span className="bg-gray-200 px-3 py-1 rounded text-sm">
                    {product.metadata.tags?.[0] || 'Serum'}
                  </span>
                )}
              </div>
              <div className="mt-auto">
                <Button className="w-full bg-pink-600 hover:bg-pink-700 text-white">
                  Add To cart
                </Button>
              </div>
            </div>
          ))}
        </div>

        {/* Shop Now Button */}
        <div className="text-center">
          <Button size="lg" className="bg-black hover:bg-gray-800 text-white px-8 py-3">
            Shop Now
          </Button>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;