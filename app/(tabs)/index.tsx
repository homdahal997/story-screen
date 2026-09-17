import { View, Text, ScrollView, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { colors, spacing } from '@/src/design-system/tokens';

const trendingDramas = [
  { id: '1', title: 'Ward of Hearts', episodes: 45, poster: 'https://picsum.photos/seed/ward1/150/200' },
  { id: '2', title: 'Neon Monsoon', episodes: 60, poster: 'https://picsum.photos/seed/neon1/150/200' },
  { id: '3', title: 'The Last Reel', episodes: 30, poster: 'https://picsum.photos/seed/reel1/150/200' },
  { id: '4', title: 'Brides in Smoke', episodes: 45, poster: 'https://picsum.photos/seed/brides1/150/200' },
];

const continueWatching = [
  { id: '1', title: 'My Repairman Dad', episode: 12, progress: 0.6, poster: 'https://picsum.photos/seed/mecha1/150/200' },
  { id: '2', title: 'Secret Marriage', episode: 5, progress: 0.3, poster: 'https://picsum.photos/seed/secret1/150/200' },
];

export default function Home() {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.ink }} contentContainerStyle={{ paddingBottom: 100 }}>
      <View style={{ padding: spacing.lg, paddingTop: spacing.xl }}>
        <Text style={{ color: colors.bone, fontSize: 28, fontWeight: '700' }}>Frame Studio</Text>
        <Text style={{ color: colors.fog, fontSize: 14, marginTop: spacing.xs }}>Discover AI-generated dramas</Text>
      </View>
      <Pressable style={{ marginHorizontal: spacing.lg, borderRadius: 12, overflow: 'hidden' }}>
        <Image source={{ uri: 'https://picsum.photos/seed/featured/400/200' }} style={{ width: '100%', height: 180 }} contentFit="cover" />
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: spacing.md, backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <Text style={{ color: colors.bone, fontSize: 18, fontWeight: '700' }}>The Shadow Keeper</Text>
          <Text style={{ color: colors.fog, fontSize: 12, marginTop: spacing.xs }}>New Episodes Available</Text>
        </View>
      </Pressable>
      {continueWatching.length > 0 && (
        <View style={{ marginTop: spacing.xl }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.lg, marginBottom: spacing.md }}>
            <Text style={{ color: colors.bone, fontSize: 18, fontWeight: '700' }}>Continue Watching</Text>
            <Pressable>
              <Text style={{ color: colors.fog, fontSize: 13 }}>See All &gt;</Text>
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg }}>
            {continueWatching.map((item) => (
              <Pressable key={item.id} style={{ marginRight: spacing.md, width: 120 }}>
                <Image source={{ uri: item.poster }} style={{ width: 120, height: 160, borderRadius: 8 }} contentFit="cover" />
                <View style={{ height: 3, backgroundColor: colors.graphite, marginTop: spacing.xs, borderRadius: 2 }}>
                  <View style={{ height: 3, width: `${item.progress * 100}%`, backgroundColor: '#8B5CF6', borderRadius: 2 }} />
                </View>
                <Text style={{ color: colors.bone, fontSize: 12, marginTop: spacing.xs }} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={{ color: colors.fog, fontSize: 10 }}>Episode {item.episode}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
      <View style={{ marginTop: spacing.xl }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.lg, marginBottom: spacing.md }}>
          <Text style={{ color: colors.bone, fontSize: 18, fontWeight: '700' }}>Trending Now</Text>
          <Pressable>
            <Text style={{ color: colors.fog, fontSize: 13 }}>See All &gt;</Text>
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg }}>
          {trendingDramas.map((item) => (
            <Pressable key={item.id} style={{ marginRight: spacing.md, width: 120 }}>
              <Image source={{ uri: item.poster }} style={{ width: 120, height: 160, borderRadius: 8 }} contentFit="cover" />
              <Text style={{ color: colors.bone, fontSize: 12, marginTop: spacing.sm }} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={{ color: colors.fog, fontSize: 10 }}>{item.episodes} Episodes</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <View style={{ margin: spacing.lg, padding: spacing.lg, backgroundColor: colors.graphite, borderRadius: 12 }}>
        <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '700' }}>Create Your Own Drama</Text>
        <Text style={{ color: colors.fog, fontSize: 13, marginTop: spacing.xs }}>Turn your ideas into AI-generated series</Text>
        <Pressable
          onPress={() => router.push('/(tabs)/studio')}
          style={{
            backgroundColor: '#8B5CF6',
            paddingVertical: spacing.sm,
            paddingHorizontal: spacing.lg,
            borderRadius: 20,
            alignSelf: 'flex-start',
            marginTop: spacing.md,
          }}
        >
          <Text style={{ color: colors.bone, fontWeight: '600', fontSize: 13 }}>Start Creating</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
