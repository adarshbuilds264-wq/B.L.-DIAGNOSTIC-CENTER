import React, { useState, useEffect } from 'react';
import {
  APIProvider,
  Map,
  AdvancedMarker,
  Pin,
  InfoWindow,
} from '@vis.gl/react-google-maps';
import { MapPin, Phone, Navigation } from 'lucide-react';

// Official B.L. Diagnostic Center coordinates in Sector 11, Pratap Nagar, Jaipur - 302033
const BL_DIAGNOSTIC_LOCATION = {
  lat: 26.8035,
  lng: 75.8226,
};

interface LaboratoryMapProps {
  heightClassName?: string;
}

export const LaboratoryMap: React.FC<LaboratoryMapProps> = ({
  heightClassName = 'h-[340px]',
}) => {
  const [infoOpen, setInfoOpen] = useState(true);
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

  useEffect(() => {
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      if (
        args.some(
          (a) =>
            typeof a === 'string' &&
            /OverQuotaMapError|QuotaExceeded|OVER_QUERY_LIMIT|RESOURCE_EXHAUSTED/.test(a)
        )
      ) {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
      }
      origError.apply(console, args);
    };
    return () => {
      console.error = origError;
    };
  }, []);

  if (!apiKey) {
    return (
      <div
        className={`w-full ${heightClassName} bg-slate-100 rounded-xl border border-slate-200 flex flex-col items-center justify-center p-6 text-center`}
      >
        <MapPin className="w-8 h-8 text-[#0F294A] mb-2" />
        <p className="text-sm font-bold text-[#0F294A]">B.L. Diagnostic Center</p>
        <p className="text-xs text-slate-600 mt-1">
          Near Post Office, Kumbha Marg, Sector 11, Pratap Nagar, Jaipur - 302033
        </p>
      </div>
    );
  }

  return (
    <div className={`w-full ${heightClassName} rounded-xl overflow-hidden border border-slate-200 relative`}>
      <APIProvider apiKey={apiKey}>
        <Map
          defaultCenter={BL_DIAGNOSTIC_LOCATION}
          defaultZoom={15}
          mapId="DEMO_MAP_ID"
          gestureHandling="cooperative"
          disableDefaultUI={false}
          className="w-full h-full"
        >
          <AdvancedMarker
            position={BL_DIAGNOSTIC_LOCATION}
            onClick={() => setInfoOpen(true)}
            title="B.L. Diagnostic Center"
          >
            <Pin
              background="#0F294A"
              borderColor="#059669"
              glyphColor="#FFFFFF"
            />
          </AdvancedMarker>

          {infoOpen && (
            <InfoWindow
              position={BL_DIAGNOSTIC_LOCATION}
              onCloseClick={() => setInfoOpen(false)}
              pixelOffset={[0, -36]}
            >
              <div className="p-1 max-w-[230px] text-slate-800">
                <p className="font-bold text-xs text-[#0F294A]">B.L. Diagnostic Center</p>
                <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">
                  Near Post Office, Kumbha Marg, Sector 11, Pratap Nagar, Jaipur - 302033
                </p>
                <div className="mt-2 pt-1.5 border-t border-slate-200 flex items-center justify-between gap-2">
                  <a
                    href="tel:9649183422"
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 hover:underline"
                  >
                    <Phone className="w-3 h-3" />
                    9649183422
                  </a>
                  <a
                    href="https://www.google.com/maps/search/?api=1&query=Near+Post+Office,+Kumbha+Marg,+Sector+11,+Pratap+Nagar,+Jaipur+302033"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0F294A] hover:underline"
                  >
                    <Navigation className="w-3 h-3" />
                    Directions
                  </a>
                </div>
              </div>
            </InfoWindow>
          )}
        </Map>
      </APIProvider>
    </div>
  );
};
