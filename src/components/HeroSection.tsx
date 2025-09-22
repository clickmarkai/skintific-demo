import { useState, useEffect } from "react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";
import { ChevronsRight } from "lucide-react";

// Load all images placed in src/assets/carousel and sort them by filename
const heroImageModules = import.meta.glob("@/assets/carousel/*.{png,jpg,jpeg,webp,avif}", {
  eager: true,
}) as Record<string, { default: string }>;
const HERO_IMAGES: string[] = Object.keys(heroImageModules)
  .sort()
  .map((k) => heroImageModules[k].default);

const HeroSection = () => {

  // Track carousel selection for dots
  const [carouselApi, setCarouselApi] = useState<CarouselApi | undefined>();
  const [selected, setSelected] = useState(0);
  const [slideCount, setSlideCount] = useState(0);

  useEffect(() => {
    if (!carouselApi) return;
    const onSelect = () => setSelected(carouselApi.selectedScrollSnap());
    setSlideCount(carouselApi.scrollSnapList().length);
    onSelect();
    carouselApi.on("select", onSelect);
    return () => {
      carouselApi.off("select", onSelect);
    };
  }, [carouselApi]);

  return (
    <section className="bg-white overflow-hidden">
      {/* Hero carousel visuals */}
      <div className="w-screen">
        <Carousel opts={{ loop: true }} setApi={setCarouselApi}>
          <CarouselContent>
            {(HERO_IMAGES.length ? HERO_IMAGES : []).map((src, idx) => (
              <CarouselItem key={idx}>
                <div className="relative w-screen bg-white">
                  <img
                    src={src}
                    alt={`Carousel ${idx + 1}`}
                    className="block w-screen h-auto"
                  />
                  {/* CTA: tuned to float above the base like the reference */}
                  <div
                    className="absolute z-10 pointer-events-none right-[7vw] bottom-[46%] md:bottom-[28%] lg:bottom-[34%]"
                  >
                    <a href="#" className="pointer-events-auto text-black font-semibold tracking-wide text-[34px] md:text-[46px] lg:text-[46px] flex items-center gap-3">
                      <span>SHOP NOW</span>
                      <ChevronsRight className="inline-block -mb-[2px]" strokeWidth={2} style={{ width: '1.35em', height: '1.35em' }} />
                    </a>
                  </div>
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className="bg-white/90 hover:bg-white shadow" />
          <CarouselNext className="bg-white/90 hover:bg-white shadow" />
        </Carousel>
        {slideCount > 1 && (
          <div className="flex items-center justify-center gap-2 py-3">
            {Array.from({ length: slideCount }).map((_, i) => (
              <span key={i} className={`h-2 w-2 rounded-full ${i === selected ? 'bg-black' : 'bg-black/30'}`} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default HeroSection;