import { colors, spacing } from '@/src/design-system/tokens';
import * as api from '@/src/services/api';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';

const PURPLE = '#8B5CF6';
const categories = ['All', 'Romance', 'Thriller', 'Sci-Fi', 'Drama', 'Comedy'];

export default function Featured() {
  const insets = useSafeAreaInsets();
  const [activeCategory, setActiveCategory] = useState('All');
  const { data, isLoading } = useQuery({ queryKey: ['featured'], queryFn: api.getFeatured });

  const filtered = useMemo(() => {
    const list = data?.featured ?? [];
    return activeCategory === 'All' ? list : list.filter((d) => d.genre === activeCategory);
  }, [data, activeCategory]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink, paddingTop: insets.top }}>
      <View style={{ padding: spacing.lg }}>
        <Text style={{ color: colors.bone, fontSize: 28, fontWeight: '700' }}>Featured</Text>
        <Text style={{ color: colors.fog, fontSize: 14, marginTop: spacing.xs }}>Handpicked dramas for you</Text>
      </View>

      <View style={{ height: 56 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm, alignItems: 'center' }}>
          {categories.map((cat) => (
            <Pressable
              key={cat}
              testID={`category-${cat}`}
              onPress={() => setActiveCategory(cat)}
              style={{ flexShrink: 0, height: 36, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: 18, backgroundColor: activeCategory === cat ? PURPLE : colors.graphite }}
            >
              <Text style={{ color: activeCategory === cat ? colors.bone : colors.fog, fontSize: 13, fontWeight: '600' }}>{cat}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {isLoading ? (
        <ActivityIndicator color={PURPLE} style={{ marginTop: spacing.xl }} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
            {filtered.map((item) => (
              <View key={item.id} style={{ width: '47%' }}>
                <Image source={{ uri: item.poster }} style={{ width: '100%', height: 180, borderRadius: 8 }} contentFit="cover" />
                <Text style={{ color: colors.bone, fontSize: 14, fontWeight: '600', marginTop: spacing.sm }} numberOfLines={1}>{item.title}</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs }}>
                  <Text style={{ color: colors.fog, fontSize: 11 }}>{item.genre}</Text>
                  <Text style={{ color: '#FFD700', fontSize: 11 }}>★ {item.rating}</Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
