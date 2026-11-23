@file:OptIn(ExperimentalMaterial3Api::class)

package io.github.fr_ost.hisab.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Category
import androidx.compose.material.icons.outlined.CloudSync
import androidx.compose.material.icons.outlined.Savings
import androidx.compose.material.icons.outlined.Sms
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.fr_ost.hisab.BuildConfig
import io.github.fr_ost.hisab.core.Backup
import io.github.fr_ost.hisab.core.Category
import io.github.fr_ost.hisab.core.CategoryKind
import io.github.fr_ost.hisab.core.Dates
import io.github.fr_ost.hisab.core.Edits
import io.github.fr_ost.hisab.core.ExpenseScope
import io.github.fr_ost.hisab.core.Money
import io.github.fr_ost.hisab.core.NumberFormat
import io.github.fr_ost.hisab.data.Outcome
import io.github.fr_ost.hisab.ui.theme.PALETTE_KEYS
import io.github.fr_ost.hisab.ui.theme.paletteColor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun MoreScreen(book: Book) {
    val navigator = LocalNavigator.current
    Column(Modifier.fillMaxSize()) {
        ScreenBar("More")
        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item {
                val waiting by LocalRepository.current.waiting.collectAsStateWithLifecycle()
                Section(null) {
                    NavRow(
                        "Import SMS",
                        if (waiting.isEmpty()) "Read bank and wallet messages" else "${waiting.size} ${if (waiting.size == 1) "message needs" else "messages need"} a look",
                        Icons.Outlined.Sms,
                    ) { navigator.open(Screen.Sms) }
                }
            }
            item {
                Section(null) {
                    NavRow("Budgets", "Monthly budgets for Personal and Family", Icons.Outlined.Savings) { navigator.open(Screen.Budgets) }
                    RowDivider()
                    NavRow("Categories", "${book.live.categories.count { !it.isArchived }} in use", Icons.Outlined.Category) { navigator.open(Screen.Categories) }
                }
            }
            item {
                Section(null) {
                    NavRow("Backup and restore", "A file of everything you recorded", Icons.Outlined.CloudSync) { navigator.open(Screen.Backup) }
                    RowDivider()
                    NavRow("Preferences", "Your name, currency and number style", Icons.Outlined.Tune) { navigator.open(Screen.Preferences) }
                }
            }
            item {
                Text("Hisab ${BuildConfig.VERSION_NAME} · Everything stays on this phone.", style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 4.dp))
            }
        }
    }
}

/** Categories for spending and income: rename, recolour, archive or delete. */
@Composable
fun CategoriesScreen(book: Book) {
    var kind by rememberSaveable { mutableStateOf(CategoryKind.EXPENSE) }
    var editing by remember { mutableStateOf<Category?>(null) }
    var adding by remember { mutableStateOf(false) }
    val list = book.live.categories.filter { it.kind == kind }.sortedWith(compareBy<Category> { it.isArchived }.thenBy { it.sortOrder })
    val used = remember(book) { book.live.transactions.groupingBy { it.categoryId }.eachCount() }

    Column(Modifier.fillMaxSize()) {
        ScreenBar("Categories") { TextButton(onClick = { adding = true }) { Text("Add") } }
        LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = kind == CategoryKind.EXPENSE, onClick = { kind = CategoryKind.EXPENSE }, label = { Text("Spending") })
                    FilterChip(selected = kind == CategoryKind.INCOME, onClick = { kind = CategoryKind.INCOME }, label = { Text("Income") })
                }
            }
            item {
                Section(null) {
                    list.forEachIndexed { index, c ->
                        if (index > 0) RowDivider()
                        ListRow(
                            title = c.name,
                            subtitle = listOfNotNull(
                                c.defaultScope?.let { if (it == ExpenseScope.FAMILY) "Family" else "Personal" },
                                used[c.id]?.let { "$it ${if (it == 1) "entry" else "entries"}" },
                                if (c.isArchived) "Archived" else null,
                            ).joinToString(" · "),
                            leading = { Dot(paletteColor(c.color), label = c.name) },
                            onClick = { editing = c },
                        )
                    }
                }
            }
        }
    }
    if (adding || editing != null) {
        CategoryDialog(book, editing, kind) {
            adding = false
            editing = null
        }
    }
}

@Composable
private fun CategoryDialog(book: Book, existing: Category?, kind: CategoryKind, onClose: () -> Unit) {
    val repository = LocalRepository.current
    val messages = LocalMessages.current
    var name by remember { mutableStateOf(existing?.name ?: "") }
    var scope by remember { mutableStateOf(existing?.defaultScope ?: ExpenseScope.PERSONAL) }
    var color by remember { mutableStateOf(existing?.color ?: "green") }
    var archived by remember { mutableStateOf(existing?.isArchived ?: false) }
    var error by remember { mutableStateOf<String?>(null) }
    val categoryKind = existing?.kind ?: kind
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text(if (existing == null) "New category" else "Edit category") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(name, { name = it.take(40) }, label = { Text("Name") }, singleLine = true, isError = error != null,
                    supportingText = error?.let { { Text(it) } })
                if (categoryKind == CategoryKind.EXPENSE) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(selected = scope == ExpenseScope.PERSONAL, onClick = { scope = ExpenseScope.PERSONAL }, label = { Text("Personal") })
                        FilterChip(selected = scope == ExpenseScope.FAMILY, onClick = { scope = ExpenseScope.FAMILY }, label = { Text("Family") })
                    }
                }
                PickerField("Colour", color, PALETTE_KEYS, { it.replaceFirstChar(Char::uppercase) }, { color = it })
                if (existing != null) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Archived", modifier = Modifier.weight(1f))
                        Switch(checked = archived, onCheckedChange = { archived = it })
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val outcome = repository.edit { data ->
                    listOf(Edits.saveCategory(data, name, categoryKind, scope, existing?.icon ?: "circle-dashed", color, archived, existing?.id))
                }
                when (outcome) {
                    Outcome.Done -> onClose()
                    is Outcome.Refused -> error = outcome.message
                }
            }) { Text("Save") }
        },
        dismissButton = {
            Row {
                if (existing != null) {
                    TextButton(onClick = {
                        when (val outcome = repository.edit { Edits.deleteCategory(it, existing.id) }) {
                            Outcome.Done -> {
                                messages.show("${existing.name} deleted")
                                onClose()
                            }
                            is Outcome.Refused -> error = outcome.message
                        }
                    }) { Text("Delete") }
                }
                TextButton(onClick = onClose) { Text("Cancel") }
            }
        },
    )
}

/** A monthly budget for each scope, and how much of it is spent. */
@Composable
fun BudgetsScreen(book: Book) {
    val repository = LocalRepository.current
    val messages = LocalMessages.current
    var month by rememberSaveable { mutableStateOf(Dates.monthOf(book.today)) }
    val scopes = remember(book, month) { book.analytics.scopeTotals(Dates.monthStart(month), Dates.monthEnd(month), book.currencies.conversion) }
    Column(Modifier.fillMaxSize()) {
        ScreenBar("Budgets")
        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item { MonthSwitcher(month, { month = it }) }
            ExpenseScope.entries.forEach { scope ->
                item(key = scope.name) {
                    val budget = Edits.budgetFor(book.live, scope, month)
                    val spent = scopes.firstOrNull { it.scope == scope }?.total ?: 0L
                    var text by remember(budget) { mutableStateOf(budget?.let { Money.editable(it.amount) } ?: "") }
                    Section(if (scope == ExpenseScope.PERSONAL) "Personal" else "Family") {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            if (budget != null && budget.amount > 0) BudgetBar("Spent", spent, budget.amount, book.format)
                            else Text("Spent ${book.format.money(spent)} — no budget set.", style = MaterialTheme.typography.bodyMedium)
                            AmountField("Monthly budget from ${Format.month(month)} on", text, { text = it }, prefix = Money.symbol(book.format.base))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(onClick = {
                                    val amount = Money.parseInput(text) ?: 0L
                                    repository.edit { data -> listOf(Edits.setBudget(data, scope, month, amount)) }
                                    messages.show("Budget saved")
                                }) { Text("Save") }
                                if (budget?.effectiveFrom == Dates.monthStart(month)) {
                                    OutlinedButton(onClick = {
                                        repository.edit { data -> listOf(Edits.setBudget(data, scope, month, null)) }
                                        messages.show("Budget removed")
                                    }) { Text("Remove") }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Your name, main currency and how numbers are written. */
@Composable
fun PreferencesScreen(book: Book) {
    val repository = LocalRepository.current
    val messages = LocalMessages.current
    var name by remember { mutableStateOf(book.settings.displayName) }
    var currency by remember { mutableStateOf(book.settings.baseCurrency) }
    var grouping by remember { mutableStateOf(book.settings.numberFormat) }
    Column(Modifier.fillMaxSize()) {
        ScreenBar("Preferences")
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(name, { name = it.take(60) }, label = { Text("Your name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            PickerField("Main currency", currency, (Format.CURRENCIES + currency).distinct(), { it }, { currency = it })
            Text("Totals are in your main currency; other currencies count at their rate.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            PickerField("Numbers", grouping, NumberFormat.entries, { if (it == NumberFormat.SOUTH_ASIAN) "1,23,456 (South Asian)" else "123,456 (International)" }, { grouping = it })
            Button(onClick = {
                val outcome = repository.edit { data ->
                    listOf(Edits.updateSettings(data) { it.copy(displayName = name.trim(), baseCurrency = currency, numberFormat = grouping) })
                }
                messages.show(if (outcome == Outcome.Done) "Saved" else (outcome as Outcome.Refused).message)
            }) { Text("Save") }
        }
    }
}

/** A file of everything: save it anywhere, or restore one (the website's too). */
@Composable
fun BackupScreen(book: Book) {
    val repository = LocalRepository.current
    val messages = LocalMessages.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var pending by remember { mutableStateOf<String?>(null) }
    var preview by remember { mutableStateOf<Backup.Read.Ok?>(null) }

    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val ok = withContext(Dispatchers.IO) {
                runCatching {
                    context.contentResolver.openOutputStream(uri)?.use { it.write(repository.backupText(BuildConfig.VERSION_NAME).toByteArray(Charsets.UTF_8)) }
                }.isSuccess
            }
            messages.show(if (ok) "Backup saved" else "Couldn't save the backup there")
        }
    }
    val open = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val text = withContext(Dispatchers.IO) {
                runCatching { context.contentResolver.openInputStream(uri)?.use { input -> input.readBytes().takeIf { it.size <= 32 * 1024 * 1024 }?.toString(Charsets.UTF_8) } }.getOrNull()
            }
            when (val read = text?.let(Backup::read) ?: Backup.Read.Bad("Couldn't read that file.")) {
                is Backup.Read.Ok -> {
                    pending = text
                    preview = read
                }
                is Backup.Read.Bad -> messages.show(read.message)
            }
        }
    }

    Column(Modifier.fillMaxSize()) {
        ScreenBar("Backup and restore")
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            val summary = Backup.summarize(book.live)
            Text(
                "A backup file holds everything you have recorded: ${summary.accounts} accounts, ${summary.transactions} entries, " +
                    "${summary.balanceUpdates} balance updates, your categories, budgets and preferences. The website reads the same files.",
                style = MaterialTheme.typography.bodyMedium,
            )
            Button(onClick = { save.launch("hisab-backup-${book.today}.json") }, modifier = Modifier.fillMaxWidth()) { Text("Save a backup file") }
            OutlinedButton(onClick = { open.launch(arrayOf("application/json", "application/octet-stream", "text/plain")) }, modifier = Modifier.fillMaxWidth()) {
                Text("Restore from a file")
            }
            Text("Moving from the website? In Hisab on the web, open Settings → Backup and restore → Download a backup, then restore that file here.",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }

    val shown = preview
    if (shown != null && pending != null) {
        val s = shown.summary
        Confirm(
            "Replace everything?",
            "This file has ${s.accounts} accounts, ${s.transactions} entries and ${s.balanceUpdates} balance updates (saved ${shown.exportedAt.take(10)}). " +
                "Everything on this phone now is replaced by it.",
            "Replace",
            onConfirm = {
                val text = pending!!
                pending = null
                preview = null
                scope.launch {
                    val result = repository.restore(text)
                    messages.show(if (result is Backup.Read.Ok) "Restored" else (result as Backup.Read.Bad).message)
                }
            },
            onDismiss = {
                pending = null
                preview = null
            },
        )
    }
}
