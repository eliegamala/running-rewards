/**
 * Mock participating stores. Each store (the business/brand) is one choice a reward credit
 * can be spent at; unlocking is handled separately in `reward-credit.ts`.
 * A store has one or more physical locations where the reward can be redeemed.
 * Shaped so it can later be swapped for an API response without touching the UI.
 */

import type { ImageSourcePropType } from 'react-native';

export type StoreCategory = 'coffee' | 'matcha' | 'breakfast' | 'run-club';

export type StoreLocation = {
  /** Branch/area name shown to the runner, e.g. a neighbourhood. Null until known. */
  name: string | null;
  address: string;
  /** Opened as-is with `Linking`. Null until a real link is supplied. */
  googleMapsUrl: string | null;
};

export const ADDRESS_COMING_SOON = 'Address coming soon';

// Placeholder until the real address and Maps link are supplied. Never guess these.
function locationComingSoon(): StoreLocation {
  return { name: null, address: ADDRESS_COMING_SOON, googleMapsUrl: null };
}

export type Store = {
  id: string;
  name: string;
  category: StoreCategory;
  /** What this store offers when a runner spends their reward credit here. */
  reward: string;
  description: string;
  /** Where the reward can be redeemed. One entry for now; more as a business adds branches. */
  locations: StoreLocation[];
  /** Optional product photo (transparent PNG). Stores without one use the cup illustration. */
  productImage?: ImageSourcePropType;
};

export const CATEGORIES: { id: StoreCategory; label: string; emoji: string }[] = [
  { id: 'coffee', label: 'Coffee', emoji: '☕' },
  { id: 'matcha', label: 'Matcha', emoji: '🍵' },
  { id: 'breakfast', label: 'Breakfast', emoji: '🥐' },
  { id: 'run-club', label: 'Run Clubs', emoji: '🏃' },
];

export const STORES: Store[] = [
  {
    id: 'plato',
    name: 'Platō',
    category: 'coffee',
    reward: '10% off your coffee',
    description: 'Small-batch espresso and a slow morning bar worth the early start.',
    locations: [locationComingSoon()],
    productImage: require('@/assets/images/products/plato-matcha.png'),
  },
  {
    id: 'love-matcha',
    name: 'Love Matcha',
    category: 'matcha',
    reward: '15% off',
    description: 'Ceremonial-grade matcha, whisked to order. Iced, oat, or straight up.',
    locations: [locationComingSoon()],
    productImage: require('@/assets/images/products/matcha-latte.png'),
  },
  {
    id: 'partner-coffee',
    name: 'Partner Coffee',
    category: 'coffee',
    reward: '10% off any drink',
    description: 'Single-origin pour-overs for the runners who go the long way round.',
    locations: [locationComingSoon()],
    productImage: require('@/assets/images/products/matcha-latte.png'),
  },
  {
    id: 'partner-cafe',
    name: 'Partner Café',
    category: 'breakfast',
    reward: 'Free pastry',
    description: 'Fresh croissants out of the oven by the time you finish your loop.',
    locations: [locationComingSoon()],
    productImage: require('@/assets/images/products/matcha-latte.png'),
  },
];

export function getCategory(id: StoreCategory) {
  return CATEGORIES.find((category) => category.id === id) ?? CATEGORIES[0];
}

export function getStore(id: string) {
  return STORES.find((store) => store.id === id);
}

/** The location to show for a store. Every store has at least one. */
export function getPrimaryLocation(store: Store) {
  return store.locations[0];
}
