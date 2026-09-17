import { View, Text, ScrollView, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { colors, spacing } from '@/src/design-system/tokens';

const stats = [
  { label: 'Projects', value: '3' },
  { label: 'Episodes', value: '45' },
  { label: 'Views', value: '12.5K' },
  { label: 'Earnings', value: '$250' },
];

const menuItems = [
  { id: '1', icon: '👤', label: 'Edit Profile' },
  { id: '2', icon: '💳', label: 'Payment & Earnings' },
  { id: '3', icon: '📊', label: 'Analytics' },
  { id: '4', icon: '⚙️', label: 'Settings' },
  { id: '5', icon: '❓', label: 'Help & Support' },
  { id: '6', icon: '📄', label: 'Terms & Privacy' },
];

export default function Profile() {
  const { logout } = useAuth();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.ink }} contentContainerStyle={{ paddingBottom: 100 }}>
      <View style={{ padding: spacing.lg, paddingTop: spacing.xl, alignItems: 'center' }}>
        <Image
          source={{ uri: 'https://picsum.photos/seed/avatar/100/100' }}
          style={{ width: 80, height: 80, borderRadius: 40, marginBottom: spacing.md }}
        />
        <Text style={{ color: colors.bone, fontSize: 20, fontWeight: '700' }}>Creator Name</Text>
        <Text style={{ color: colors.fog, fontSize: 13, marginTop: spacing.xs }}>creator@email.com</Text>
        <View
          style={{
            backgroundColor: '#8B5CF6',
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.xs,
            borderRadius: 12,
            marginTop: spacing.sm,
          }}
        >
          <Text style={{ color: colors.bone, fontSize: 11, fontWeight: '600' }}>PRO CREATOR</Text>
        </View>
      </View>
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-around', marginVertical: spacing.lg, paddingHorizontal: spacing.lg }}
      >
        {stats.map((stat) => (
          <View key={stat.label} style={{ alignItems: 'center' }}>
            <Text style={{ color: colors.bone, fontSize: 20, fontWeight: '700' }}>{stat.value}</Text>
            <Text style={{ color: colors.fog, fontSize: 11, marginTop: spacing.xs }}>{stat.label}</Text>
          </View>
        ))}
      </View>
      <View style={{ paddingHorizontal: spacing.lg }}>
        {menuItems.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => alert(item.label)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: colors.graphite,
              padding: spacing.md,
              borderRadius: 8,
              marginBottom: spacing.sm,
            }}
          >
            <Text style={{ fontSize: 18, marginRight: spacing.md }}>{item.icon}</Text>
            <Text style={{ color: colors.bone, fontSize: 15, flex: 1 }}>{item.label}</Text>
            <Text style={{ color: colors.fog, fontSize: 16 }}>›</Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        onPress={() => {
          logout();
          router.replace('/auth');
        }}
        style={{
          marginHorizontal: spacing.lg,
          marginTop: spacing.lg,
          padding: spacing.md,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: colors.signal,
          alignItems: 'center',
        }}
      >
        <Text style={{ color: colors.signal, fontSize: 15, fontWeight: '600' }}>Log Out</Text>
      </Pressable>
    </ScrollView>
  );
}
