<!--
Copyright 2024 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->
<template>
  <v-dialog
    v-model="dialog"
    fullscreen
    hide-overlay
    transition="false"
    :scrim="false"
  >
    <v-card>
      <v-toolbar color="transparent">
        <v-btn icon @click="dialog = false">
          <v-icon>mdi-arrow-left</v-icon>
        </v-btn>
        <v-toolbar-title>Settings</v-toolbar-title>
      </v-toolbar>
      <v-divider></v-divider>
      <v-container class="pa-8 ml-6" max-width="800">
        <v-list density="compact">
          <v-list-subheader class="text-h6 font-weight-bold mb-2">
            AI
          </v-list-subheader>
          <v-alert
            v-if="!llmsAvailable"
            type="warning"
            variant="tonal"
            density="compact"
            class="mb-2 mx-4"
            icon="mdi-alert-circle"
          >
            The server does not have any LLMs configured. AI features are
            disabled.
          </v-alert>

          <v-list-item>
            <template v-slot:prepend>
              <v-list-item-action start>
                <v-switch
                  v-model="settings.AIEnabled"
                  color="primary"
                  hide-details
                  :disabled="!llmsAvailable"
                ></v-switch>
              </v-list-item-action>
            </template>
            <v-list-item-title
              class="text-body-2 font-weight-medium"
              :class="{ 'text-grey': !llmsAvailable }"
            >
              Enable AI features
            </v-list-item-title>
            <v-list-item-subtitle class="text-caption">
              Enable or disable all AI related features
            </v-list-item-subtitle>
          </v-list-item>

          <div :class="{ 'opacity-50': !settings.AIEnabled }">
            <v-list-item :disabled="!settings.AIEnabled">
              <template v-slot:prepend>
                <v-list-item-action start>
                  <v-checkbox
                    v-model="settings.AIFileSummaries"
                    color="primary"
                    hide-details
                    :disabled="!settings.AIEnabled || !llmsAvailable"
                  ></v-checkbox>
                </v-list-item-action>
              </template>
              <v-list-item-title class="text-body-2 font-weight-medium">
                File summarization
              </v-list-item-title>
              <v-list-item-subtitle class="text-caption">
                Enable or disable LLM generated summaries for files
              </v-list-item-subtitle>
            </v-list-item>

            <v-list-item :disabled="!settings.AIEnabled">
              <template v-slot:prepend>
                <v-list-item-action start>
                  <v-checkbox
                    v-model="settings.AIFileChat"
                    color="primary"
                    hide-details
                    :disabled="!settings.AIEnabled || !llmsAvailable"
                  ></v-checkbox>
                </v-list-item-action>
              </template>
              <v-list-item-title class="text-body-2 font-weight-medium">
                Assistant chat for files
              </v-list-item-title>
              <v-list-item-subtitle class="text-caption">
                Enable or disable LLM chat for files
              </v-list-item-subtitle>
            </v-list-item>

            <v-list-item :disabled="!settings.AIEnabled">
              <template v-slot:prepend>
                <v-list-item-action start>
                  <v-checkbox
                    v-model="settings.AIWorkflowName"
                    color="primary"
                    hide-details
                    :disabled="!settings.AIEnabled || !llmsAvailable"
                  ></v-checkbox>
                </v-list-item-action>
              </template>
              <v-list-item-title class="text-body-2 font-weight-medium">
                Workflow name generation
              </v-list-item-title>
              <v-list-item-subtitle class="text-caption">
                Enable or disable LLM generated names for workflows
              </v-list-item-subtitle>
            </v-list-item>
          </div>

          <v-list-subheader class="text-h6 font-weight-bold mb-2">
            Workflow
          </v-list-subheader>
          <v-list-item>
            <v-list-item-title class="text-body-2 font-weight-medium">
              Default editor
            </v-list-item-title>
            <v-list-item-subtitle class="text-caption">
              Choose which editor to use as default for workflows
            </v-list-item-subtitle>
            <v-radio-group
              v-model="settings.WorkflowEditor"
              class="mt-2 ml-n2"
              inline
              hide-details
            >
              <v-radio
                label="New editor"
                value="new"
                color="primary"
                class="mr-4"
              >
                <template v-slot:label>
                  <span class="text-body-2">New editor</span>
                </template>
              </v-radio>
              <v-radio label="Old editor" value="old" color="primary">
                <template v-slot:label>
                  <span class="text-body-2">Old editor</span>
                </template>
              </v-radio>
            </v-radio-group>
          </v-list-item>
          <v-list-item>
            <template v-slot:prepend>
              <v-list-item-action start>
                <v-checkbox
                  v-model="settings.WorkflowChordCreation"
                  color="primary"
                  hide-details
                ></v-checkbox>
              </v-list-item-action>
            </template>
            <v-list-item-title class="text-body-2 font-weight-medium">
              Chord creation
            </v-list-item-title>
            <v-list-item-subtitle class="text-caption">
              Enable or disable the creation of chords in the workflow
            </v-list-item-subtitle>
          </v-list-item>
          <template v-if="uiOptions.length > 1">
            <v-list-subheader class="text-h6 font-weight-bold mb-2 mt-4">
              Interface
            </v-list-subheader>
            <v-list-item>
              <v-list-item-title
                id="web-ui-label"
                class="text-body-2 font-weight-medium"
              >
                Web UI
              </v-list-item-title>
              <v-list-item-subtitle class="text-caption">
                Choose which OpenRelik web interface to use
              </v-list-item-subtitle>
              <v-select
                :model-value="CURRENT_UI_ID"
                :items="uiOptions"
                item-title="name"
                item-value="id"
                aria-labelledby="web-ui-label"
                variant="outlined"
                density="compact"
                hide-details
                class="mt-3"
                style="max-width: 260px"
                @update:model-value="onSelectUi"
              ></v-select>
            </v-list-item>
          </template>
        </v-list>
      </v-container>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useUserSettings } from "@/composables/useUserSettings";
import { useAppStore } from "@/stores/app";
import {
  CURRENT_UI_ID,
  getAvailableUis,
  switchToUi,
} from "@/utils/uiSwitch";

const dialog = ref(false);
const availableUis = ref([]);
const { settings } = useUserSettings();
const appStore = useAppStore();

let active = true;
onMounted(async () => {
  const uis = await getAvailableUis();
  if (active) {
    availableUis.value = uis;
  }
});
onUnmounted(() => {
  active = false;
});

const uiOptions = computed(() => {
  if (availableUis.value.length < 2) {
    return [];
  }
  if (availableUis.value.some((ui) => ui.id === CURRENT_UI_ID)) {
    return availableUis.value;
  }
  return [{ id: CURRENT_UI_ID, name: "Sunstone" }, ...availableUis.value];
});

const onSelectUi = (targetId) => {
  if (targetId && targetId !== CURRENT_UI_ID) {
    switchToUi(targetId);
  }
};

const llmsAvailable = computed(() => {
  return appStore.systemConfig?.active_llms?.length > 0;
});

const open = () => {
  dialog.value = true;
};

defineExpose({
  open,
});
</script>

<style scoped>
.v-toolbar {
  flex: 0 0 auto;
}
</style>
