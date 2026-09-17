import { colors } from '@/src/design-system/tokens';
import { Tabs } from 'expo-router';
import { Platform, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.signal,
        tabBarInactiveTintColor: colors.fog,
        tabBarStyle: {
          backgroundColor: colors.ink,
          borderTopWidth: 1,
          borderTopColor: `${colors.fog}33`,
          height: 60 + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: 8,
          ...(Platform.OS === 'web' ? { height: 64 } : {}),
        },
        tabBarItemStyle: { alignSelf: 'center' },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarIcon: ({ focused }) => <Text style={{ fontSize: 20, color: focused ? colors.signal : colors.fog }}>{'\u2302'}</Text> }}
      />
      <Tabs.Screen
        name="featured"
        options={{ title: 'Featured', tabBarIcon: ({ focused }) => <Text style={{ fontSize: 20, color: focused ? colors.signal : colors.fog }}>{'\u2606'}</Text> }}
      />
      <Tabs.Screen
        name="studio"
        options={{
          title: 'Create',
          tabBarIcon: () => (
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#8B5CF6', justifyContent: 'center', alignItems: 'center', marginTop: -20 }}>
              <Text style={{ fontSize: 28, color: '#FFFFFF', fontWeight: '300' }}>+</Text>
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="mylist"
        options={{ title: 'My List', tabBarIcon: ({ focused }) => <Text style={{ fontSize: 20, color: focused ? colors.signal : colors.fog }}>{'\u2661'}</Text> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', tabBarIcon: ({ focused }) => <Text style={{ fontSize: 20, color: focused ? colors.signal : colors.fog }}>{'\u25CB'}</Text> }}
      />
      <Tabs.Screen name="explore" options={{ href: null }} />
      <Tabs.Screen name="projects" options={{ href: null }} />
    </Tabs>
  );
}
