import HeroSection from "@/components/HeroSection";
import ProductGrid from "@/components/ProductGrid";
import SkincareSections from "@/components/SkincareSections";
import ChatWidget from "@/components/ChatWidget";
import Footer from "@/sections/SiteFooter";

const Index = () => {
  return (
    <div className="min-h-screen bg-white">
      <HeroSection />
      <ProductGrid />
      <SkincareSections />
      <ChatWidget />
      <Footer />
    </div>
  );
};

export default Index;
