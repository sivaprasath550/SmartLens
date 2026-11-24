import { haversineMeters, offsetCoordinate } from '../utils/geo.js';
import { PLACE_CATEGORIES } from '../utils/validators.js';

/**
 * Fictional places used only in demo mode. Positions are expressed as a
 * bearing and a fraction of the search radius, so results are deterministic
 * for a given centre and radius and always fall inside the search circle.
 * Every record is explicitly marked `simulated: true` and named "(Demo)".
 */
const DEMO_TEMPLATES = [
  { key: 'cafe-lumen', name: 'Lumen Street Café', type: 'cafe', category: 'Café', bearing: 25, fraction: 0.18 },
  { key: 'rest-saffron', name: 'Saffron Courtyard Kitchen', type: 'restaurant', category: 'Restaurant', bearing: 110, fraction: 0.32 },
  { key: 'park-banyan', name: 'Banyan Grove Park', type: 'park', category: 'Park', bearing: 200, fraction: 0.45 },
  { key: 'museum-tide', name: 'Tidewater Heritage Museum', type: 'museum', category: 'Museum', bearing: 300, fraction: 0.62 },
  { key: 'mall-orbit', name: 'Orbit Plaza Shopping Centre', type: 'shopping_mall', category: 'Shopping mall', bearing: 70, fraction: 0.74 },
  { key: 'pharma-green', name: 'Greenleaf Pharmacy', type: 'pharmacy', category: 'Pharmacy', bearing: 160, fraction: 0.22 },
  { key: 'bus-central', name: 'Central Loop Bus Stand', type: 'bus_station', category: 'Bus station', bearing: 240, fraction: 0.28 },
  { key: 'bakery-maple', name: 'Maple & Millet Bakery', type: 'bakery', category: 'Bakery', bearing: 340, fraction: 0.38 },
  { key: 'lib-north', name: 'Northgate Public Library', type: 'library', category: 'Library', bearing: 15, fraction: 0.55 },
  { key: 'hosp-care', name: 'Carewell Community Hospital', type: 'hospital', category: 'Hospital', bearing: 130, fraction: 0.85 },
  { key: 'gallery-prism', name: 'Prism Art Gallery', type: 'art_gallery', category: 'Art gallery', bearing: 275, fraction: 0.48 },
  { key: 'hotel-harbour', name: 'Harbour View Hotel', type: 'hotel', category: 'Hotel', bearing: 185, fraction: 0.68 },
  { key: 'market-fresh', name: 'Daily Fresh Supermarket', type: 'supermarket', category: 'Supermarket', bearing: 50, fraction: 0.4 },
  { key: 'train-east', name: 'Eastline Railway Station', type: 'train_station', category: 'Train station', bearing: 95, fraction: 0.9 },
  { key: 'coffee-ember', name: 'Ember Roasters Coffee', type: 'coffee_shop', category: 'Coffee shop', bearing: 220, fraction: 0.12 },
  { key: 'uni-scholar', name: 'Scholars Ridge College', type: 'university', category: 'University', bearing: 320, fraction: 0.8 },
];

export const DEMO_ATTRIBUTION = 'Simulated demo data — these places are fictional';

export function getDemoPlaces({ latitude, longitude, radius, category = 'all', maxResults = 20 }) {
  const allowedTypes = PLACE_CATEGORIES[category] ?? [];
  return DEMO_TEMPLATES.filter((template) => allowedTypes.length === 0 || allowedTypes.includes(template.type))
    .map((template, index) => {
      const position = offsetCoordinate(latitude, longitude, radius * template.fraction, template.bearing);
      return {
        id: `demo-${template.key}`,
        name: `${template.name} (Demo)`,
        category: template.category,
        types: [template.type],
        address: `${100 + index * 7} Demo Avenue — fictional address`,
        latitude: position.latitude,
        longitude: position.longitude,
        distanceMeters: Math.round(haversineMeters(latitude, longitude, position.latitude, position.longitude)),
        mapsUri: null,
        businessStatus: 'OPERATIONAL',
        source: 'demo',
        simulated: true,
      };
    })
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, maxResults);
}
