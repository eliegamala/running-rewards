import { View } from 'react-native';

import type { StoreCategory } from '@/lib/stores';

// Top-down cup illustration used in place of café photography.
const DRINKS: Record<StoreCategory, { liquid: string; foam: string }> = {
  coffee: { liquid: '#7A4F33', foam: '#D9BC98' },
  matcha: { liquid: '#7FA548', foam: '#DDE9AC' },
  breakfast: { liquid: '#A9774F', foam: '#F1E2C8' },
  'run-club': { liquid: '#5E3D29', foam: '#C9A27E' },
};

type CupArtProps = {
  size: number;
  category: StoreCategory;
  saucerColor: string;
};

export function CupArt({ size, category, saucerColor }: CupArtProps) {
  const { liquid, foam } = DRINKS[category];
  const rim = size * 0.74;
  const handleWidth = size * 0.16;
  const handleHeight = size * 0.11;

  const circle = (diameter: number, backgroundColor: string) => ({
    width: diameter,
    height: diameter,
    borderRadius: diameter / 2,
    backgroundColor,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  });

  return (
    <View style={circle(size, saucerColor)}>
      <View
        style={{
          position: 'absolute',
          left: size / 2 + rim / 2 - handleWidth * 0.3,
          top: size / 2 - handleHeight / 2,
          width: handleWidth,
          height: handleHeight,
          borderRadius: handleHeight / 2,
          backgroundColor: '#FFFDF6',
        }}
      />
      <View style={circle(rim, '#FFFDF6')}>
        <View style={circle(rim * 0.84, liquid)}>
          <View style={circle(rim * 0.42, foam)}>
            <View style={circle(rim * 0.2, liquid)}>
              <View style={circle(rim * 0.09, foam)} />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}
