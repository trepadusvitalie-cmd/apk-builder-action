pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // Doar pentru o dependență tranzitivă a LiveKit (audioswitch).
        maven("https://jitpack.io") {
            content { includeGroup("com.github.davidliu") }
        }
    }
}
rootProject.name = "md-chat"
include(":app")
