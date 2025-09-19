import { Button } from "@/components/ui/button";

const SkincareSections = () => {
  return (
    <div className="bg-white">
      {/* SKINTIFIC 5X SERIES Section */}
      <section className="py-16 bg-gray-50">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-black mb-8">
            SKINTIFIC 5X SERIES
          </h2>
          
          <div className="grid md:grid-cols-3 gap-8 mb-12">
            <div className="text-center">
              <h3 className="text-xl font-semibold text-black mb-4">Repair Your Skin Barrier</h3>
            </div>
            <div className="text-center">
              <h3 className="text-xl font-semibold text-black mb-4">Specialize in Problematic Skin</h3>
            </div>
            <div className="text-center">
              <h3 className="text-xl font-semibold text-black mb-4">For Redness, Sensitized Skin</h3>
            </div>
          </div>
        </div>
      </section>

      {/* TARGET YOUR SKIN NEEDS Section */}
      <section className="py-16">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-black mb-8">
            TARGET YOUR SKIN NEEDS
          </h2>
          
          <div className="grid md:grid-cols-4 gap-8 mb-12">
            <div className="text-center">
              <div className="w-24 h-24 bg-pink-100 rounded-full mx-auto mb-4 flex items-center justify-center">
                <span className="text-pink-600 font-bold text-lg">REPAIR</span>
              </div>
            </div>
            <div className="text-center">
              <div className="w-24 h-24 bg-pink-100 rounded-full mx-auto mb-4 flex items-center justify-center">
                <span className="text-pink-600 font-bold text-lg">BRIGHTEN</span>
              </div>
            </div>
            <div className="text-center">
              <div className="w-24 h-24 bg-pink-100 rounded-full mx-auto mb-4 flex items-center justify-center">
                <span className="text-pink-600 font-bold text-lg">COVERAGE</span>
              </div>
            </div>
            <div className="text-center">
              <div className="w-24 h-24 bg-pink-100 rounded-full mx-auto mb-4 flex items-center justify-center">
                <span className="text-pink-600 font-bold text-lg">ANTI ACNE</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* HERO INGREDIENT Section */}
      <section className="py-16 bg-gray-50">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-black mb-12">
            HERO INGREDIENT
          </h2>
          
          <div className="grid md:grid-cols-3 gap-12">
            {/* 5X Ceramides */}
            <div className="text-center">
              <div className="w-32 h-32 bg-white rounded-full mx-auto mb-6 flex items-center justify-center shadow-lg">
                <span className="text-black font-bold text-lg">5X</span>
              </div>
              <h3 className="text-2xl font-bold text-black mb-4">5X Ceramides</h3>
              <p className="text-gray-600">
                Strengthens the skin barrier, locks in moisture, and prevents dryness.
              </p>
            </div>

            {/* Retinol */}
            <div className="text-center">
              <div className="w-32 h-32 bg-white rounded-full mx-auto mb-6 flex items-center justify-center shadow-lg">
                <span className="text-black font-bold text-lg">R</span>
              </div>
              <h3 className="text-2xl font-bold text-black mb-4">Retinol</h3>
              <p className="text-gray-600">
                Boosts cell turnover, reduces wrinkles, improves texture, and enhances collagen production.
              </p>
            </div>

            {/* 377 SYMWHITE */}
            <div className="text-center">
              <div className="w-32 h-32 bg-white rounded-full mx-auto mb-6 flex items-center justify-center shadow-lg">
                <span className="text-black font-bold text-lg">377</span>
              </div>
              <h3 className="text-2xl font-bold text-black mb-4">377 SYMWHITE</h3>
              <p className="text-gray-600">
                Brightens skin, reduces dark spots, and evens out skin tone.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Newsletter Section */}
      <section className="py-16">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-black mb-4">
            Newsletter
          </h2>
          <p className="text-lg text-gray-600 mb-8">
            Sign up and get limited <strong>10%OFF</strong>!
          </p>
          
          <div className="max-w-md mx-auto flex gap-4">
            <input 
              type="email" 
              placeholder="Enter your email" 
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-600"
            />
            <Button className="bg-pink-600 hover:bg-pink-700 text-white px-8">
              Subscribe
            </Button>
          </div>
        </div>
      </section>

      {/* Most Loved In Our Community */}
      <section className="py-16 bg-gray-50">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl md:text-4xl font-bold text-black mb-12 text-center">
            Most Loved In Our Community
          </h2>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {/* Product 1 */}
            <div className="text-center flex flex-col h-full">
              <div className="bg-gray-100 rounded-lg p-8 mb-4">
                <div className="w-32 h-32 bg-white rounded-lg mx-auto mb-4 flex items-center justify-center">
                  <span className="text-gray-400 text-sm">Product Image</span>
                </div>
              </div>
              <h3 className="font-semibold text-lg mb-2 text-black">Perfect Stay Velvet Matte Cushion</h3>
              <p className="text-gray-600 mb-2">$18.99</p>
              <p className="text-sm text-gray-500 mb-4">27 reviews</p>
              <div className="mt-auto">
                <Button className="w-full bg-pink-600 hover:bg-pink-700 text-white">
                  Add To cart
                </Button>
              </div>
            </div>

            {/* Product 2 */}
            <div className="text-center flex flex-col h-full">
              <div className="bg-gray-100 rounded-lg p-8 mb-4">
                <div className="w-32 h-32 bg-white rounded-lg mx-auto mb-4 flex items-center justify-center">
                  <span className="text-gray-400 text-sm">Product Image</span>
                </div>
              </div>
              <h3 className="font-semibold text-lg mb-2 text-black">5X Ceramide Barrier Repair Moisture Gel</h3>
              <p className="text-gray-600 mb-2">$14.99</p>
              <p className="text-sm text-gray-500 mb-4">10 reviews</p>
              <div className="mt-auto">
                <Button className="w-full bg-pink-600 hover:bg-pink-700 text-white">
                  Add To cart
                </Button>
              </div>
            </div>

            {/* Product 3 */}
            <div className="text-center flex flex-col h-full">
              <div className="bg-gray-100 rounded-lg p-8 mb-4">
                <div className="w-32 h-32 bg-white rounded-lg mx-auto mb-4 flex items-center justify-center">
                  <span className="text-gray-400 text-sm">Product Image</span>
                </div>
              </div>
              <h3 className="font-semibold text-lg mb-2 text-black">10% Pure Vitamin C Brightening Serum</h3>
              <p className="text-gray-600 mb-2">$19.99</p>
              <p className="text-sm text-gray-500 mb-4">2 reviews</p>
              <div className="mt-auto">
                <Button className="w-full bg-pink-600 hover:bg-pink-700 text-white">
                  Add To cart
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-4 gap-8 text-center">
            <div>
              <h3 className="font-bold text-lg mb-2">FREE SHIPPING</h3>
              <p className="text-gray-600">5-12 Business days shipping</p>
            </div>
            <div>
              <h3 className="font-bold text-lg mb-2">15 DAYS WARRANTY</h3>
              <p className="text-gray-600">Shop risk-free within 15 days</p>
            </div>
            <div>
              <h3 className="font-bold text-lg mb-2">SUPPORT 24/5</h3>
              <p className="text-gray-600">Contact us 24 hours on business days</p>
            </div>
            <div>
              <h3 className="font-bold text-lg mb-2">100% PAYMENT SECURE</h3>
              <p className="text-gray-600">We guarantee secure payments</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default SkincareSections;
