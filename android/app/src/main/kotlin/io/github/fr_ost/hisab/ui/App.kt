@file:OptIn(ExperimentalMaterial3Api::class)

package io.github.fr_ost.hisab.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.AccountBalanceWallet
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.SwapVert
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.fr_ost.hisab.core.Analytics
import io.github.fr_ost.hisab.core.Dates
import io.github.fr_ost.hisab.core.Ledger
import io.github.fr_ost.hisab.core.LedgerData
import io.github.fr_ost.hisab.data.Repository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

val LocalRepository = staticCompositionLocalOf<Repository> { error("No repository") }
val LocalNavigator = staticCompositionLocalOf<Navigator> { error("No navigator") }
val LocalMessages = staticCompositionLocalOf<Messages> { error("No messages") }
val LocalOpens = staticCompositionLocalOf<MutableStateFlow<String?>> { MutableStateFlow(null) }

/** The ledger as the screens read it: live records, balances and totals, worked out once per change. */
class Book(data: LedgerData) {
    val live: LedgerData = data.live()
    val today: String = Dates.today()
    val settings = live.settings
    val format = Format(live.settings)
    val ledger: Ledger by lazy { Ledger(live) }
    val analytics: Analytics by lazy { Analytics(live) }
    val currencies by lazy { analytics.currencies() }
    val summaries by lazy { ledger.summaries(today) }
    val accounts = live.accounts.associateBy { it.id }
    val categories = live.categories.associateBy { it.id }
}

sealed interface Screen {
    data object Overview : Screen
    data object Activity : Screen
    data object Accounts : Screen
    data object More : Screen
    data class AccountDetail(val id: String) : Screen
    data object Categories : Screen
    data object Budgets : Screen
    data object Preferences : Screen
    data object Backup : Screen
    data object Sms : Screen
}

/** A sheet over the current screen. */
sealed interface Sheet {
    data class NewTransaction(val accountId: String? = null) : Sheet
    data class EditTransaction(val id: String) : Sheet
    data object NewAccount : Sheet
    data class EditAccount(val id: String) : Sheet
    data class UpdateBalance(val accountId: String) : Sheet
}

/** Where the person is: a stack of screens under one of the four tabs, and maybe a sheet. */
class Navigator {
    var stack by mutableStateOf(listOf<Screen>(Screen.Overview))
        private set
    var sheet by mutableStateOf<Sheet?>(null)

    val current: Screen get() = stack.last()
    val tab: Screen get() = stack.first()

    fun tab(screen: Screen) {
        stack = listOf(screen)
    }

    fun open(screen: Screen) {
        stack = stack + screen
    }

    fun back(): Boolean = when {
        stack.size > 1 -> {
            stack = stack.dropLast(1)
            true
        }
        stack.first() != Screen.Overview -> {
            stack = listOf(Screen.Overview)
            true
        }
        else -> false
    }
}

/** Short messages at the bottom of the screen ("Saved", "Removed"). */
class Messages(private val host: SnackbarHostState, private val scope: CoroutineScope) {
    fun show(text: String) {
        scope.launch {
            host.currentSnackbarData?.dismiss()
            host.showSnackbar(text)
        }
    }
}

@Composable
fun HisabApp() {
    val repository = LocalRepository.current
    val data by repository.data.collectAsStateWithLifecycle()
    val loaded = data
    if (loaded == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val messages = remember { Messages(snackbar, scope) }
    if (loaded.isEmpty()) {
        CompositionLocalProvider(LocalMessages provides messages) {
            Scaffold(snackbarHost = { SnackbarHost(snackbar) }) { padding -> Box(Modifier.padding(padding)) { WelcomeScreen() } }
        }
        return
    }
    val book = remember(loaded) { Book(loaded) }
    val navigator = remember { Navigator() }
    // A notification's tap: Import SMS, or the entries it added.
    val opens = LocalOpens.current
    val open by opens.collectAsStateWithLifecycle()
    LaunchedEffect(open) {
        when (open) {
            "sms" -> {
                navigator.tab(Screen.More)
                navigator.open(Screen.Sms)
            }
            "activity" -> navigator.tab(Screen.Activity)
        }
        if (open != null) opens.value = null
    }
    BackHandler(enabled = navigator.stack.size > 1 || navigator.tab != Screen.Overview) { navigator.back() }

    CompositionLocalProvider(LocalNavigator provides navigator, LocalMessages provides messages) {
        val current = navigator.current
        val atTab = navigator.stack.size == 1
        Scaffold(
            snackbarHost = { SnackbarHost(snackbar) },
            bottomBar = { if (atTab) BottomBar(navigator) },
            floatingActionButton = {
                when (current) {
                    Screen.Overview, Screen.Activity -> AddButton("New transaction") { navigator.sheet = Sheet.NewTransaction() }
                    is Screen.AccountDetail -> AddButton("New transaction") { navigator.sheet = Sheet.NewTransaction(current.id) }
                    Screen.Accounts -> AddButton("New account") { navigator.sheet = Sheet.NewAccount }
                    else -> Unit
                }
            },
        ) { padding ->
            Box(Modifier.padding(padding)) {
                when (current) {
                    Screen.Overview -> OverviewScreen(book)
                    Screen.Activity -> ActivityScreen(book)
                    Screen.Accounts -> AccountsScreen(book)
                    Screen.More -> MoreScreen(book)
                    is Screen.AccountDetail -> AccountDetailScreen(book, current.id)
                    Screen.Categories -> CategoriesScreen(book)
                    Screen.Budgets -> BudgetsScreen(book)
                    Screen.Preferences -> PreferencesScreen(book)
                    Screen.Backup -> BackupScreen(book)
                    Screen.Sms -> SmsScreen(book)
                }
            }
        }
        navigator.sheet?.let { sheet -> SheetHost(sheet, book) { navigator.sheet = null } }
    }
}

@Composable
private fun AddButton(label: String, onClick: () -> Unit) {
    FloatingActionButton(onClick = onClick, containerColor = MaterialTheme.colorScheme.primary, contentColor = MaterialTheme.colorScheme.onPrimary) {
        Icon(Icons.Default.Add, contentDescription = label)
    }
}

@Composable
private fun BottomBar(navigator: Navigator) {
    NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
        listOf(
            Triple(Screen.Overview, "Overview", Icons.Outlined.Home),
            Triple(Screen.Activity, "Activity", Icons.Outlined.SwapVert),
            Triple(Screen.Accounts, "Accounts", Icons.Outlined.AccountBalanceWallet),
            Triple(Screen.More, "More", Icons.Outlined.MoreHoriz),
        ).forEach { (screen, label, icon) ->
            NavigationBarItem(
                selected = navigator.tab == screen,
                onClick = { navigator.tab(screen) },
                icon = { Icon(icon, contentDescription = null) },
                label = { Text(label) },
            )
        }
    }
}

/** The bar at the top of a screen; with a back arrow below the tabs. */
@Composable
fun ScreenBar(title: String, actions: @Composable () -> Unit = {}) {
    val navigator = LocalNavigator.current
    TopAppBar(
        title = { Text(title) },
        navigationIcon = {
            if (navigator.stack.size > 1) {
                IconButton(onClick = { navigator.back() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
            }
        },
        actions = { actions() },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
    )
}

/** An icon for a menu entry. */
typealias Glyph = ImageVector
