import HeroSection from "@/components/HeroSection";
import ProductGrid from "@/components/ProductGrid";
import SkincareSections from "@/components/SkincareSections";
import ChatWidget from "@/components/ChatWidget";

const Index = () => {
  return (
    <div className="min-h-screen bg-white">
      <HeroSection />
      <ProductGrid />
      <SkincareSections />
      <ChatWidget />
    </div>
  );
};

export default Index;
