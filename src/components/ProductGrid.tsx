import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { supabase, Product } from "@/lib/supabase";

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

  return (
    <section className="bg-white py-16">
      <div className="container mx-auto px-4">
        {/* Products Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
          {products.map((product) => (
            <div key={product.id} className="text-center flex flex-col h-full">
              {/* Product Image */}
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
              
              {/* Product Name */}
              <h3 className="font-semibold text-lg mb-2 text-black">{product.metadata.title}</h3>
              
              {/* Price */}
              <p className="text-gray-600 mb-2">${product.metadata.price}</p>
              
              {/* Reviews - Generate random reviews for demo */}
              <p className="text-sm text-gray-500 mb-4">
                {Math.floor(Math.random() * 50) + 1} reviews
              </p>
              
              {/* Variants or Size */}
              <div className="flex justify-center gap-2 mb-4 flex-wrap">
                {product.metadata.variant_title ? (
                  <span className="bg-gray-200 px-3 py-1 rounded text-sm">
                    {product.metadata.variant_title}
                  </span>
                ) : null}
              </div>
              
              {/* Tags */}
              {product.metadata.tags && product.metadata.tags.length > 0 && (
                <div className="flex justify-center gap-2 mb-4 flex-wrap">
                  {product.metadata.tags.slice(0, 2).map((tag, index) => (
                    <span key={index} className="bg-pink-100 text-pink-800 px-2 py-1 rounded text-xs">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              
              {/* Add to Cart Button */}
              <div className="mt-auto">
                <Button className="w-full bg-pink-600 hover:bg-pink-700 text-white">
                  Add To cart
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ProductGrid;