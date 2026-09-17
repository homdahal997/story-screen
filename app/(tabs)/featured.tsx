import { useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { colors, spacing } from '@/src/design-system/tokens';

const categories = ['All', 'Romance', 'Thriller', 'Sci-Fi', 'Drama', 'Comedy'];

const featuredDramas = [
  { id: '1', title: 'Ward of Hearts', genre: 'Thriller', rating: 4.8, poster: 'https://picsum.photos/seed/f1/150/200' },
  { id: '2', title: 'Neon Monsoon', genre: 'Romance', rating: 4.6, poster: 'https://picsum.photos/seed/f2/150/200' },
  { id: '3', title: 'The Last Reel', genre: 'Drama', rating: 4.9, poster: 'https://picsum.photos/seed/f3/150/200' },
  { id: '4', title: 'Brides in Smoke', genre: 'Romance', rating: 4.7, poster: 'https://picsum.photos/seed/f4/150/200' },
  { id: '5', title: 'Mecha God', genre: 'Sci-Fi', rating: 4.5, poster: 'https://picsum.photos/seed/f5/150/200' },
  { id: '6', title: 'Dark Alliance', genre: 'Thriller', rating: 4.4, poster: 'https://picsum.photos/seed/f6/150/200' },
];

export default function Featured() {
  const [activeCategory, setActiveCategory] = useState('All');
  const filtered = activeCategory === 'All' ? featuredDramas : featuredDramas.filter((d) => d.genre === activeCategory);

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      <View style={{ padding: spacing.lg, paddingTop: spacing.xl }}>
        <Text style={{ color: colors.bone, fontSize: 28, fontWeight: '700' }}>Featured</Text>
        <Text style={{ color: colors.fog, fontSize: 14, marginTop: spacing.xs }}>Handpicked dramas for you</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, marginBottom: spacing.md }}
      >
        {categories.map((cat) => (
          <Pressable
            key={cat}
            onPress={() => setActiveCategory(cat)}
            style={{
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              borderRadius: 20,
              backgroundColor: activeCategory === cat ? '#8B5CF6' : colors.graphite,
              marginRight: spacing.sm,
            }}
          >
            <Text style={{ color: colors.bone, fontSize: 13, fontWeight: '600' }}>{cat}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 100 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
          {filtered.map((item) => (
            <Pressable key={item.id} style={{ width: '47%' }}>
              <Image source={{ uri: item.poster }} style={{ width: '100%', height: 180, borderRadius: 8 }} contentFit="cover" />
              <Text style={{ color: colors.bone, fontSize: 14, fontWeight: '600', marginTop: spacing.sm }} numberOfLines={1}>
                {item.title}
              </Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs }}>
                <Text style={{ color: colors.fog, fontSize: 11 }}>{item.genre}</Text>
                <Text style={{ color: '#FFD700', fontSize: 11 }}>★ {item.rating}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
