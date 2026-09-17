import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { AuthProvider } from '@/src/context/AuthContext';
import { colors } from '@/src/design-system/tokens';

const FrameStudioTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.ink,
    card: colors.graphite,
    text: colors.bone,
    border: colors.fog,
    primary: colors.signal,
  },
};

export default function RootLayout() {
  return (
    <AuthProvider>
      <ThemeProvider value={FrameStudioTheme}>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="auth" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="create/[id]" />
          <Stack.Screen name="create/assets" />
          <Stack.Screen name="create/pipeline" />
          <Stack.Screen name="project/[id]" />
        </Stack>
      </ThemeProvider>
    </AuthProvider>
  );
}
