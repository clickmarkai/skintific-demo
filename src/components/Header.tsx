import { ShoppingCart, Search, Menu, User, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const Header = () => {
  return (
    <header className="bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60 sticky top-0 z-50 w-full border-b border-gray-200">
      {/* Top banner */}
      <div className="bg-black text-white text-center py-2 text-sm">
        ✈️ FREE SHIPPING & SAVE 10% OVER $50🔥
      </div>
      
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center space-x-4">
          <Button variant="ghost" size="icon" className="md:hidden">
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold text-black">
            SKINTIFIC
          </h1>
        </div>

        {/* Navigation */}
        <nav className="hidden md:flex items-center space-x-8">
          <a href="#" className="text-black hover:text-pink-600 transition-colors font-medium">Best Sellers</a>
          <a href="#" className="text-black hover:text-pink-600 transition-colors font-medium">New Launch</a>
          <div className="relative group">
            <a href="#" className="text-black hover:text-pink-600 transition-colors font-medium flex items-center">
              Skin Care
              <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </a>
            {/* Dropdown would go here */}
          </div>
          <a href="#" className="text-black hover:text-pink-600 transition-colors font-medium">Makeup</a>
          <a href="#" className="text-black hover:text-pink-600 transition-colors font-medium">About Skintific</a>
        </nav>

        {/* Search Bar */}
        <div className="hidden md:flex items-center space-x-2 flex-1 max-w-sm mx-8">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <Input 
              placeholder="Search products..." 
              className="pl-10 bg-gray-50 border-gray-200 focus:bg-white transition-colors"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center space-x-2">
          <Button variant="ghost" size="icon" className="relative text-black hover:text-pink-600">
            <Heart className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" className="relative text-black hover:text-pink-600">
            <User className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" className="relative text-black hover:text-pink-600">
            <ShoppingCart className="h-5 w-5" />
            <span className="absolute -top-1 -right-1 bg-pink-600 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
              0
            </span>
          </Button>
        </div>
      </div>
    </header>
  );
};

export default Header;