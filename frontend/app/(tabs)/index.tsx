import { colors, spacing } from '@/src/design-system/tokens';
import * as api from '@/src/services/api';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';

const PURPLE = '#8B5CF6';

export default function Home() {
  const insets = useSafeAreaInsets();
  const { data, isLoading } = useQuery({ queryKey: ['featured'], queryFn: api.getFeatured });
  const trending = data?.trending ?? [];
  const featured = data?.featured ?? [];
  const hero = featured[0];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.ink }} contentContainerStyle={{ paddingTop: insets.top, paddingBottom: spacing.xxl }}>
      <View style={{ padding: spacing.lg }}>
        <Text style={{ color: colors.bone, fontSize: 28, fontWeight: '700' }}>Frame Studio</Text>
        <Text style={{ color: colors.fog, fontSize: 14, marginTop: spacing.xs }}>Discover AI-generated dramas</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator color={PURPLE} style={{ marginTop: spacing.xl }} />
      ) : (
        <>
          {hero && (
            <View style={{ marginHorizontal: spacing.lg, borderRadius: 12, overflow: 'hidden' }}>
              <Image source={{ uri: hero.poster }} style={{ width: '100%', height: 180 }} contentFit="cover" />
              <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: spacing.md, backgroundColor: 'rgba(0,0,0,0.6)' }}>
                <Text style={{ color: colors.bone, fontSize: 18, fontWeight: '700' }}>{hero.title}</Text>
                <Text style={{ color: colors.fog, fontSize: 12, marginTop: spacing.xs }}>{hero.episodes} Episodes · {hero.genre}</Text>
              </View>
            </View>
          )}

          <View style={{ marginTop: spacing.xl }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.lg, marginBottom: spacing.md }}>
              <Text style={{ color: colors.bone, fontSize: 18, fontWeight: '700' }}>Trending Now</Text>
              <Pressable onPress={() => router.push('/(tabs)/featured')}>
                <Text style={{ color: colors.fog, fontSize: 13 }}>See All ›</Text>
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg }}>
              {trending.map((item) => (
                <View key={item.id} style={{ marginRight: spacing.md, width: 120 }}>
                  <Image source={{ uri: item.poster }} style={{ width: 120, height: 160, borderRadius: 8 }} contentFit="cover" />
                  <Text style={{ color: colors.bone, fontSize: 12, marginTop: spacing.sm }} numberOfLines={1}>{item.title}</Text>
                  <Text style={{ color: colors.fog, fontSize: 10 }}>{item.episodes} Episodes</Text>
                </View>
              ))}
            </ScrollView>
          </View>

          <View style={{ margin: spacing.lg, padding: spacing.lg, backgroundColor: colors.graphite, borderRadius: 12 }}>
            <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '700' }}>Create Your Own Drama</Text>
            <Text style={{ color: colors.fog, fontSize: 13, marginTop: spacing.xs }}>Turn your ideas into AI-generated series</Text>
            <Pressable
              testID="home-start-creating"
              onPress={() => router.push('/(tabs)/studio')}
              style={{ backgroundColor: PURPLE, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: 20, alignSelf: 'flex-start', marginTop: spacing.md }}
            >
              <Text style={{ color: colors.bone, fontWeight: '600', fontSize: 13 }}>Start Creating</Text>
            </Pressable>
          </View>
        </>
      )}
    </ScrollView>
  );
}
