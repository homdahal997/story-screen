import { colors, spacing } from '@/src/design-system/tokens';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

export default function ProjectDetail() {
  const { id, title, episodes } = useLocalSearchParams<{ id: string; title: string; episodes: string }>();
  const [menuVisible, setMenuVisible] = useState(false);
  const [synopsisExpanded, setSynopsisExpanded] = useState(false);

  const totalEpisodes = parseInt(episodes || '60', 10);
  const episodeList = Array.from({ length: totalEpisodes }, (_, i) => ({
    id: i + 1,
    status: i === 0 ? 'Asset Completed' : 'Pending Creation',
  }));

  const synopsis = `Wedding planner Chloe marries billionaire Marcus to save her brother from debt. Their fake contract unravels as she uncovers a deadly family secret—the disappearance of Marcus's first wife. Trust shatters, but so do the walls around their hearts.`;

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: spacing.lg,
          paddingTop: spacing.xl,
        }}
      >
        <Pressable
          onPress={() => router.replace('/(tabs)/studio')}
          hitSlop={12}
          style={{ padding: 8, minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center', marginLeft: -8 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={{ color: colors.bone, fontSize: 24 }}>‹</Text>
        </Pressable>
        <Pressable
          onPress={() => setMenuVisible(true)}
          hitSlop={12}
          style={{ padding: 8, minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center', marginRight: -8 }}
          accessibilityRole="button"
          accessibilityLabel="Menu"
        >
          <Text style={{ color: colors.bone, fontSize: 20 }}>⋮</Text>
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 120 }}>
        {/* Project Info */}
        <View style={{ flexDirection: 'row', marginBottom: spacing.lg }}>
          <View
            style={{
              width: 60,
              height: 70,
              backgroundColor: colors.graphite,
              borderRadius: 8,
              justifyContent: 'center',
              alignItems: 'center',
              marginRight: spacing.md,
            }}
          >
            <Text style={{ color: colors.fog, fontSize: 24 }}>🎬</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.bone, fontSize: 18, fontWeight: '700' }}>{title || 'Untitled Project'}</Text>
            <Text style={{ color: colors.fog, fontSize: 13, marginTop: spacing.xs }}>
              0 of {totalEpisodes} Episodes Created
            </Text>
            <View
              style={{
                backgroundColor: colors.graphite,
                paddingHorizontal: spacing.sm,
                paddingVertical: 2,
                borderRadius: 4,
                alignSelf: 'flex-start',
                marginTop: spacing.sm,
              }}
            >
              <Text style={{ color: colors.bone, fontSize: 11 }}>Draft</Text>
            </View>
          </View>
        </View>

        {/* Story Synopsis */}
        <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '700', marginBottom: spacing.sm }}>Story Synopsis</Text>
        <View style={{ marginBottom: spacing.lg }}>
          <Text style={{ color: colors.fog, fontSize: 13, lineHeight: 20 }} numberOfLines={synopsisExpanded ? undefined : 3}>
            {synopsis}
          </Text>
          <Pressable onPress={() => setSynopsisExpanded(!synopsisExpanded)}>
            <Text style={{ color: colors.bone, fontSize: 13, fontWeight: '600', marginTop: spacing.xs }}>
              {synopsisExpanded ? 'Collapse' : 'Expand'}
            </Text>
          </Pressable>
        </View>

        {/* Episode List */}
        <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '700', marginBottom: spacing.md }}>Episode List</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
          {episodeList.map((ep) => (
            <Pressable
              key={ep.id}
              onPress={() =>
                router.push({
                  pathname: '/create/pipeline',
                  params: { episodeId: ep.id.toString(), step: ep.status === 'Pending Creation' ? '1' : '3' },
                })
              }
              style={{
                width: '30%',
                aspectRatio: 0.85,
                backgroundColor: colors.graphite,
                borderRadius: 8,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              {ep.status === 'Pending Creation' ? (
                <>
                  <Text style={{ color: colors.fog, fontSize: 28 }}>+</Text>
                  <Text style={{ color: colors.fog, fontSize: 9, textAlign: 'center', marginTop: spacing.xs }}>
                    Pending{'\n'}Creation
                  </Text>
                </>
              ) : (
                <Text style={{ color: '#4ADE80', fontSize: 10, textAlign: 'center' }}>Asset{'\n'}Completed</Text>
              )}
            </Pressable>
          ))}
        </View>
        {episodeList.map((ep) => (
          <View key={`label-${ep.id}`} style={{ display: 'none' }} />
        ))}

        {/* Episode Labels - placed in grid flow */}
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: spacing.md,
            marginTop: -Math.ceil(totalEpisodes / 3) * (spacing.md + 10),
          }}
        >
          {episodeList.map((ep) => (
            <View key={`label-${ep.id}`} style={{ width: '30%' }}>
              <Text style={{ color: colors.bone, fontSize: 12, marginTop: spacing.xs }}>Episode {ep.id}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Publish Button */}
      <View style={{ padding: spacing.lg, paddingBottom: spacing.xl }}>
        <Pressable
          onPress={() => alert('Publishing...')}
          style={{
            backgroundColor: '#E63946',
            paddingVertical: spacing.md,
            borderRadius: 24,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: colors.bone, fontWeight: '700', fontSize: 16 }}>Publish</Text>
        </Pressable>
      </View>

      {/* Dropdown Menu Modal */}
      <Modal visible={menuVisible} transparent animationType="fade">
        <Pressable style={{ flex: 1 }} onPress={() => setMenuVisible(false)}>
          <View
            style={{ position: 'absolute', top: 60, right: spacing.lg, backgroundColor: '#2C2C2E', borderRadius: 8, overflow: 'hidden' }}
          >
            <Pressable
              onPress={() => {
                setMenuVisible(false);
                alert('Edit');
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                padding: spacing.md,
                borderBottomWidth: 1,
                borderBottomColor: `${colors.fog}22`,
              }}
            >
              <Text style={{ color: colors.bone, marginRight: spacing.sm }}>✎</Text>
              <Text style={{ color: colors.bone, fontSize: 14 }}>Edit</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setMenuVisible(false);
                alert('Manage');
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                padding: spacing.md,
                borderBottomWidth: 1,
                borderBottomColor: `${colors.fog}22`,
              }}
            >
              <Text style={{ color: colors.bone, marginRight: spacing.sm }}>⚙</Text>
              <Text style={{ color: colors.bone, fontSize: 14 }}>Manage</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setMenuVisible(false);
                alert('Delete');
              }}
              style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.md }}
            >
              <Text style={{ color: '#E63946', marginRight: spacing.sm }}>🗑</Text>
              <Text style={{ color: '#E63946', fontSize: 14 }}>Delete</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
