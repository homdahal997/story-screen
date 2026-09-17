import { colors, spacing } from '@/src/design-system/tokens';
import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

const projects = [
  {
    id: '1',
    title: 'नक़ली विवाह',
    episodes: 60,
    createdEpisodes: 0,
    status: 'Draft',
  },
];

export default function MyList() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      
      {/* Header */}
      <View style={{ padding: spacing.lg, paddingTop: spacing.xl }}>
        <Text style={{ color: colors.bone, fontSize: 24, fontWeight: '700' }}>My Projects</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 100 }}>
        {projects.length === 0 ? (
          <View style={{ alignItems: 'center', marginTop: spacing.xxl }}>
            <Text style={{ color: colors.fog, fontSize: 16 }}>No projects yet</Text>
            <Pressable
              onPress={() => router.push('/(tabs)/studio')}
              style={{ marginTop: spacing.lg, backgroundColor: '#8B5CF6', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: 24 }}
            >
              <Text style={{ color: colors.bone, fontWeight: '600' }}>Create Your First Project</Text>
            </Pressable>
          </View>
        ) : (
          projects.map((project) => (
            <Pressable
              key={project.id}
              onPress={() => router.push({
                pathname: '/project/[id]',
                params: { id: project.id, title: project.title, episodes: project.episodes.toString() },
              })}
              style={{
                backgroundColor: colors.graphite,
                borderRadius: 8,
                padding: spacing.md,
                marginBottom: spacing.md,
                flexDirection: 'row',
              }}
            >
              <View style={{ width: 50, height: 60, backgroundColor: `${colors.fog}22`, borderRadius: 6, justifyContent: 'center', alignItems: 'center', marginRight: spacing.md }}>
                <Text style={{ color: colors.fog, fontSize: 20 }}>🎬</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.bone, fontSize: 16, fontWeight: '700' }}>{project.title}</Text>
                <Text style={{ color: colors.fog, fontSize: 12, marginTop: spacing.xs }}>
                  {project.createdEpisodes} of {project.episodes} Episodes Created
                </Text>
                <View style={{ backgroundColor: `${colors.fog}33`, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 4, alignSelf: 'flex-start', marginTop: spacing.sm }}>
                  <Text style={{ color: colors.bone, fontSize: 10 }}>{project.status}</Text>
                </View>
              </View>
              <Text style={{ color: colors.fog, fontSize: 16 }}>›</Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}
