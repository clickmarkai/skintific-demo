import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const SiteFooter = () => {
  return (
    <footer className="bg-white border-t border-gray-200">
      <div className="container mx-auto px-4 py-12">
        <div className="grid md:grid-cols-4 gap-8">
          <div>
            <div className="text-2xl font-bold text-black mb-4">SKINTIFIC</div>
            <p className="text-xs text-gray-500">The NO.1 Skincare Brand in Southeast Asia</p>
          </div>

          <div>
            <h4 className="text-sm font-bold text-black mb-3">NEWSLETTER</h4>
            <p className="text-sm text-gray-600 mb-4">Sign up and get limited <strong>10%OFF</strong>!</p>
            <div className="flex gap-2">
              <Input placeholder="Your e-mail" className="h-10" />
              <Button className="h-10 px-4">→</Button>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-bold text-black mb-3">SUPPORT</h4>
            <ul className="space-y-2 text-sm text-gray-700">
              <li><a className="hover:text-black" href="#">Track My Order</a></li>
              <li><a className="hover:text-black" href="#">Shipping & Delivery</a></li>
              <li><a className="hover:text-black" href="#">Returns & Refunds Policy</a></li>
              <li><a className="hover:text-black" href="#">FAQs</a></li>
              <li><a className="hover:text-black" href="#">Privacy Policy</a></li>
              <li><a className="hover:text-black" href="#">Terms of Service</a></li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-bold text-black mb-3">ABOUT US</h4>
            <ul className="space-y-2 text-sm text-gray-700">
              <li><a className="hover:text-black" href="#">Skintific®</a></li>
              <li><a className="hover:text-black" href="mailto:cs@skintific.com">cs@skintific.com</a></li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex items-center justify-between flex-wrap gap-4">
          <p className="text-xs text-gray-500">©2025 SKINTIFIC® All rights reserved.</p>
          <div className="flex items-center gap-3 opacity-80">
            <img src="/favicon.ico" alt="payment" className="w-8 h-8" />
            <div className="w-8 h-5 rounded bg-gray-200" />
            <div className="w-8 h-5 rounded bg-gray-200" />
            <div className="w-8 h-5 rounded bg-gray-200" />
            <div className="w-8 h-5 rounded bg-gray-200" />
          </div>
        </div>
      </div>
    </footer>
  );
};

export default SiteFooter;


