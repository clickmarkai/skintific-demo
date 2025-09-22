import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LogOut, User, ShoppingCart, Search, Menu, Heart } from 'lucide-react';
import logo from '@/assets/skintific_logo.webp';

const Navigation = () => {
  const { user, logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const navigate = useNavigate();

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await logout();
    navigate('/login');
    setIsLoggingOut(false);
  };

  return (
    <header className="bg-white sticky top-0 z-50 w-full">
      {/* Main top row */}
      <div className="px-4 h-[84px] flex items-center justify-between">
        {/* Centered logo with tagline to the right */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-3">
          <img src={logo} alt="SKINTIFIC" className="h-8 md:h-9 w-auto select-none" />
        </div>

        {/* Right controls: search, account, cart */}
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden md:flex items-center">
            <div className="relative">
              <Input placeholder="What are you looking for?" className="w-[300px] pr-10 pl-3 h-10 rounded-md border" />
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
            </div>
          </div>
          <Button variant="ghost" size="icon" className="text-black">
            <User className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" className="relative text-black" onClick={() => navigate('/cart')}>
            <ShoppingCart className="h-5 w-5" />
            <span className="absolute -top-1 -right-1 bg-black text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
              0
            </span>
          </Button>
          <Button variant="ghost" size="icon" className="md:hidden">
            <Menu className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-gray-200" />

      {/* Bottom nav row */}
      <div className="container mx-auto px-4 h-[44px] flex items-center justify-center">
        <nav className="flex items-center gap-10 text-[15px]">
          <a href="#" className="text-black hover:text-gray-700">Best Sellers</a>
          <a href="#" className="text-black hover:text-gray-700">New Launch</a>
          <a href="#" className="text-black hover:text-gray-700 flex items-center">Skin Care
            <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </a>
          <a href="#" className="text-black hover:text-gray-700">Makeup</a>
          <a href="#" className="text-black hover:text-gray-700">About Skintific</a>
        </nav>
      </div>
      <div className="border-b border-gray-200" />
    </header>
  );
};

export default Navigation;
