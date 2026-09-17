import { colors, spacing } from '@/src/design-system/tokens';
import { useAuth } from '@/src/context/AuthContext';
import * as api from '@/src/services/api';
import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';

const PURPLE = '#8B5CF6';

const menuItems = [
  { id: '1', icon: '👤', label: 'Edit Profile' },
  { id: '2', icon: '💳', label: 'Payment & Earnings' },
  { id: '3', icon: '📊', label: 'Analytics' },
  { id: '4', icon: '⚙️', label: 'Settings' },
  { id: '5', icon: '❓', label: 'Help & Support' },
  { id: '6', icon: '📄', label: 'Terms & Privacy' },
];

export default function Profile() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: api.listProjects });

  const projectCount = projects?.length ?? 0;
  const sceneCount = projects?.reduce((n, p) => n + p.scenes.length, 0) ?? 0;
  const clipCount = projects?.reduce((n, p) => n + p.scenes.filter((s) => s.clip?.status === 'READY').length, 0) ?? 0;
  const initials = (user?.name || user?.email || 'C').trim().charAt(0).toUpperCase();

  const stats = [
    { label: 'Projects', value: String(projectCount) },
    { label: 'Scenes', value: String(sceneCount) },
    { label: 'Clips', value: String(clipCount) },
  ];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.ink }} contentContainerStyle={{ paddingTop: insets.top, paddingBottom: spacing.xxl }}>
      <View style={{ padding: spacing.lg, alignItems: 'center' }}>
        <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: PURPLE, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.md }}>
          <Text style={{ color: colors.bone, fontSize: 32, fontWeight: '700' }}>{initials}</Text>
        </View>
        <Text testID="profile-name" style={{ color: colors.bone, fontSize: 20, fontWeight: '700' }}>{user?.name || 'Creator'}</Text>
        <Text style={{ color: colors.fog, fontSize: 13, marginTop: spacing.xs }}>{user?.email}</Text>
        <View style={{ backgroundColor: PURPLE, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: 12, marginTop: spacing.sm }}>
          <Text style={{ color: colors.bone, fontSize: 11, fontWeight: '600' }}>CREATOR</Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginVertical: spacing.lg, paddingHorizontal: spacing.lg }}>
        {stats.map((stat) => (
          <View key={stat.label} style={{ alignItems: 'center' }}>
            <Text style={{ color: colors.bone, fontSize: 20, fontWeight: '700' }}>{stat.value}</Text>
            <Text style={{ color: colors.fog, fontSize: 11, marginTop: spacing.xs }}>{stat.label}</Text>
          </View>
        ))}
      </View>

      <View style={{ paddingHorizontal: spacing.lg }}>
        {menuItems.map((item) => (
          <Pressable key={item.id} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.graphite, padding: spacing.md, borderRadius: 8, marginBottom: spacing.sm }}>
            <Text style={{ fontSize: 18, marginRight: spacing.md }}>{item.icon}</Text>
            <Text style={{ color: colors.bone, fontSize: 15, flex: 1 }}>{item.label}</Text>
            <Text style={{ color: colors.fog, fontSize: 16 }}>›</Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        testID="logout-button"
        onPress={async () => { await logout(); router.replace('/auth'); }}
        style={{ marginHorizontal: spacing.lg, marginTop: spacing.lg, padding: spacing.md, borderRadius: 8, borderWidth: 1, borderColor: colors.signal, alignItems: 'center' }}
      >
        <Text style={{ color: colors.signal, fontSize: 15, fontWeight: '600' }}>Log Out</Text>
      </Pressable>
    </ScrollView>
  );
}
