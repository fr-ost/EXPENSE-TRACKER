@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package io.github.fr_ost.hisab.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.fr_ost.hisab.HisabApplication
import io.github.fr_ost.hisab.SmsReading
import io.github.fr_ost.hisab.core.AccountInput
import io.github.fr_ost.hisab.core.CategoryKind
import io.github.fr_ost.hisab.core.Dates
import io.github.fr_ost.hisab.core.Edits
import io.github.fr_ost.hisab.core.EntryType
import io.github.fr_ost.hisab.core.ExpenseScope
import io.github.fr_ost.hisab.core.Money
import io.github.fr_ost.hisab.core.sms.Direction
import io.github.fr_ost.hisab.core.sms.ReceivedAt
import io.github.fr_ost.hisab.core.sms.SmsImport
import io.github.fr_ost.hisab.core.sms.SmsItem
import io.github.fr_ost.hisab.core.sms.SmsParser
import io.github.fr_ost.hisab.core.sms.SmsStatus
import io.github.fr_ost.hisab.data.Outcome
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private fun granted(context: Context, permission: String) =
    ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

/** A message on the screen: waiting from the phone's inbox, or pasted. */
private data class Entry(val text: String, val sender: String?, val receivedAt: ReceivedAt?, val waiting: Boolean) {
    val key: String = SmsImport.fingerprint(text)
}

/**
 * Import SMS: automatic reading of bank and wallet messages (with what it
 * reads, said before Android asks), the last 30 days of the inbox, pasted
 * messages, and every message that needs a look — each read on this phone
 * by the website's own reader.
 */
@Composable
fun SmsScreen(book: Book) {
    val repository = LocalRepository.current
    val messages = LocalMessages.current
    val navigator = LocalNavigator.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val waiting by repository.waiting.collectAsStateWithLifecycle()

    var automatic by remember { mutableStateOf(repository.readsSmsAutomatically && granted(context, Manifest.permission.RECEIVE_SMS)) }
    var disclosure by remember { mutableStateOf(false) }
    var scanning by remember { mutableStateOf(false) }
    var paste by remember { mutableStateOf("") }
    val pasted = remember { mutableStateListOf<String>() }
    /** What the person changed about a message (edited draft, a duplicate found, an error), by fingerprint. */
    val changed = remember { mutableStateMapOf<String, SmsItem>() }
    var editing by remember { mutableStateOf<SmsItem?>(null) }

    fun scan() {
        if (!granted(context, Manifest.permission.READ_SMS)) {
            messages.show("Allow Hisab to read SMS first")
            return
        }
        scanning = true
        scope.launch {
            val app = context.applicationContext as HisabApplication
            val before = repository.waiting.value.size
            val (found, added) = withContext(Dispatchers.Default) {
                val recent = SmsReading.recentInbox(context)
                recent.size to SmsReading.read(app, recent, notify = false)
            }
            scanning = false
            val waitingNow = repository.waiting.value.size - before
            messages.show(
                when {
                    found == 0 -> "No bank or wallet SMS in the last ${SmsReading.RECENT_DAYS} days"
                    else -> "Read $found SMS: $added added${if (waitingNow > 0) ", $waitingNow need a look" else ""}"
                },
            )
        }
    }

    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val receive = result[Manifest.permission.RECEIVE_SMS] ?: granted(context, Manifest.permission.RECEIVE_SMS)
        repository.readsSmsAutomatically = receive
        automatic = receive
        if (receive) {
            messages.show("New bank and wallet SMS are added as they arrive")
        } else {
            messages.show("Android didn't allow it. You can still paste messages.")
        }
    }

    val entries = remember(waiting, pasted.toList()) {
        val fromPhone = waiting.map { w ->
            val (date, time) = Dates.local(w.receivedAt)
            Entry(w.text, w.sender, ReceivedAt(date, time), waiting = true)
        }
        val seen = fromPhone.map { it.key }.toMutableSet()
        fromPhone + pasted.map { Entry(it, null, null, waiting = false) }.filter { seen.add(it.key) }
    }
    val remembered = remember(book) { SmsImport.rememberedAccounts(book.live, book.today) }
    val cards = remember(book, entries, changed.toMap()) {
        entries.map { entry ->
            val fresh = SmsImport.build(entry.text, book.live, book.today, remembered, entry.receivedAt)
            val kept = changed[entry.key]
            // Once it is in the ledger, the ledger's view wins.
            entry to if (kept != null && fresh.status != SmsStatus.EXISTS) kept else fresh
        }
    }

    fun add(item: SmsItem, allowDuplicate: Boolean = false, sameAs: String? = null) {
        val key = SmsImport.fingerprint(item.text)
        val result = repository.addSms(item, allowDuplicate, sameAs)
        when (result.status) {
            SmsStatus.ADDED -> {
                changed.remove(key)
                messages.show(if (result.ids.size > 1) "Added, with its fee" else "Added")
            }
            SmsStatus.EXISTS -> {
                changed.remove(key)
                messages.show(if (sameAs != null) "Linked to the entry you recorded" else "Already added")
            }
            SmsStatus.DUPLICATE -> changed[key] = item.copy(status = SmsStatus.DUPLICATE, similar = result.similar)
            else -> changed[key] = item.copy(status = SmsStatus.ERROR, error = result.error, errorField = result.errorField)
        }
    }

    fun skip(entry: Entry) {
        changed.remove(entry.key)
        if (entry.waiting) repository.dealtWith(listOf(entry.text)) else pasted.remove(entry.text)
    }

    Column(Modifier.fillMaxSize()) {
        ScreenBar("Import SMS")
        LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item {
                OutlinedCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text("Read bank and wallet SMS", style = MaterialTheme.typography.titleMedium)
                                Text(
                                    if (automatic) "On: new messages are added as they arrive." else "Off: paste messages below, or turn this on.",
                                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Switch(checked = automatic, onCheckedChange = { on ->
                                if (on) {
                                    disclosure = true
                                } else {
                                    repository.readsSmsAutomatically = false
                                    automatic = false
                                    messages.show("Off. Android's settings can also take back the SMS permission.")
                                }
                            })
                        }
                        if (automatic) {
                            OutlinedButton(onClick = { scan() }, enabled = !scanning) {
                                if (scanning) CircularProgressIndicator(Modifier.padding(end = 8.dp).size(16.dp), strokeWidth = 2.dp)
                                Text(if (scanning) "Reading…" else "Read the last ${SmsReading.RECENT_DAYS} days")
                            }
                        }
                        Text(
                            "Only messages from banks and wallets about money are read, on this phone. Messages from people and verification codes never are, and nothing is sent anywhere.",
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = paste,
                        onValueChange = { paste = it.take(50_000) },
                        label = { Text("Paste messages") },
                        placeholder = { Text("One or more bank or wallet SMS") },
                        minLines = 3,
                        maxLines = 8,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = {
                            val split = SmsParser.splitMessages(paste)
                            if (split.isEmpty()) {
                                messages.show("Paste a message first")
                            } else {
                                split.forEach { if (it !in pasted) pasted += it }
                                paste = ""
                            }
                        }, enabled = paste.isNotBlank()) { Text("Read") }
                        val ready = cards.filter { it.second.status == SmsStatus.READY }
                        if (ready.size > 1) {
                            OutlinedButton(onClick = { ready.forEach { add(it.second) } }) { Text("Add all ${ready.size} ready") }
                        }
                    }
                }
            }
            if (cards.isEmpty()) {
                item {
                    Empty(
                        "Nothing to look at",
                        if (automatic) "Messages Hisab can't add by itself wait here." else "Pasted messages show here, ready to add.",
                    )
                }
            }
            items(cards, key = { it.first.key }) { (entry, item) ->
                SmsCard(
                    book = book,
                    entry = entry,
                    item = item,
                    onAdd = { add(item) },
                    onAddAnyway = { add(item, allowDuplicate = true) },
                    onSame = { id -> add(item, sameAs = id) },
                    onEdit = { editing = item },
                    onSkip = { skip(entry) },
                    onChange = { changed[entry.key] = it },
                    onCreateAccount = { suggestion ->
                        if (suggestion.name.isBlank()) {
                            navigator.sheet = Sheet.NewAccount
                        } else {
                            val outcome = repository.edit { data ->
                                listOf(
                                    Edits.saveAccount(
                                        data,
                                        AccountInput(suggestion.name, suggestion.type, book.settings.baseCurrency, suggestion.openingBalance, suggestion.openingDate),
                                    ),
                                )
                            }
                            when (outcome) {
                                Outcome.Done -> {
                                    changed.remove(entry.key)
                                    messages.show("${suggestion.name} added")
                                }
                                is Outcome.Refused -> messages.show(outcome.message)
                            }
                        }
                    },
                    onSaveBalance = { accountId, amount ->
                        val reportedAt = if (SmsImport.isBalanceOnly(item)) ReceivedAt(item.draft.date, item.draft.time) else null
                        when (val outcome = repository.saveSmsBalance(item.text, accountId, amount, reportedAt)) {
                            Outcome.Done -> messages.show("Balance saved")
                            is Outcome.Refused -> messages.show(outcome.message)
                        }
                    },
                )
            }
        }
    }

    if (disclosure) {
        AlertDialog(
            onDismissRequest = { disclosure = false },
            title = { Text("Let Hisab read bank and wallet SMS?") },
            text = {
                Text(
                    "Hisab reads the SMS your banks and wallets send — payments, transfers, cash outs and balances — to record them for you. " +
                        "Only messages from a bank or wallet's name or short code that mention money are read; messages from people and " +
                        "verification codes never are. Everything stays on this phone: nothing is sent to Hisab or anyone else.\n\n" +
                        "Android will ask to let Hisab receive and read SMS, and to show a notification for each one it adds.",
                )
            },
            confirmButton = {
                Button(onClick = {
                    disclosure = false
                    val wanted = buildList {
                        add(Manifest.permission.RECEIVE_SMS)
                        add(Manifest.permission.READ_SMS)
                        if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
                    }
                    ask.launch(wanted.toTypedArray())
                }) { Text("Continue") }
            },
            dismissButton = { TextButton(onClick = { disclosure = false }) { Text("Not now") } },
        )
    }

    editing?.let { item ->
        val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ModalBottomSheet(onDismissRequest = { editing = null }, sheetState = state) {
            Column(
                Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, bottom = 32.dp).imePadding(),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                SmsItemEditor(book, item, onClose = { editing = null }) { edited ->
                    changed[SmsImport.fingerprint(item.text)] = edited
                    editing = null
                }
            }
        }
    }
}

private fun statusLabel(item: SmsItem): String = when (item.status) {
    SmsStatus.READY -> "Ready"
    SmsStatus.REVIEW -> "Needs a look"
    SmsStatus.IGNORED -> item.parsed.ignored?.label ?: "Not a transaction"
    SmsStatus.ADDED, SmsStatus.EXISTS -> "Added"
    SmsStatus.DUPLICATE -> "Already recorded?"
    SmsStatus.ERROR -> "Can't add yet"
}

@Composable
private fun SmsCard(
    book: Book,
    entry: Entry,
    item: SmsItem,
    onAdd: () -> Unit,
    onAddAnyway: () -> Unit,
    onSame: (String) -> Unit,
    onEdit: () -> Unit,
    onSkip: () -> Unit,
    onChange: (SmsItem) -> Unit,
    onCreateAccount: (SmsImport.AccountSuggestion) -> Unit,
    onSaveBalance: (String, Long) -> Unit,
) {
    val format = book.format
    var expanded by remember { mutableStateOf(false) }
    val draft = item.draft
    val own = book.accounts[SmsImport.ownAccountId(item)]
    val from = book.accounts[draft.accountId]
    val to = book.accounts[draft.toAccountId]
    val reported = SmsImport.reportedBalance(item, book.live.accounts, book.today)
    val missing = SmsImport.missingAccount(item)
    val suggestion = SmsImport.suggestAccount(item, book.settings.baseCurrency)
    val done = item.status == SmsStatus.EXISTS || item.status == SmsStatus.ADDED

    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    listOfNotNull(item.parsed.provider?.name ?: entry.sender, entry.receivedAt?.let { "${Format.day(it.date, book.today)}${it.time?.let { t -> ", ${Format.time(t)}" } ?: ""}" })
                        .joinToString(" · ").ifEmpty { "Pasted" },
                    style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f),
                )
                AssistChip(onClick = {}, label = { Text(statusLabel(item)) })
            }
            if (item.status != SmsStatus.IGNORED || draft.amount != null) {
                val verb = when (draft.type) {
                    EntryType.INCOME -> "Received"
                    EntryType.TRANSFER -> "Moved"
                    else -> "Spent"
                }
                val amount = draft.amount?.let { format.money(it, from?.currency ?: own?.currency ?: format.base) } ?: "—"
                Text(listOf("$verb $amount", draft.description).filter { it.isNotEmpty() }.joinToString(" · "), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                val where = when (draft.type) {
                    EntryType.TRANSFER -> "${from?.name ?: "?"} → ${to?.name ?: "?"}"
                    else -> from?.name ?: "No account"
                }
                val category = book.categories[draft.categoryId]?.name
                Text(
                    listOfNotNull(where, category, Format.date(draft.date) + (draft.time?.let { " · ${Format.time(it)}" } ?: "")).joinToString(" · "),
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            item.fee?.amount?.takeIf { !done }?.let { fee ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = item.includeFee, onCheckedChange = { onChange(item.copy(includeFee = it)) })
                    Text("Fee ${format.money(fee, own?.currency ?: format.base)} as its own expense", style = MaterialTheme.typography.bodyMedium)
                }
            }
            if (reported != null && (!done || SmsImport.needsBalanceSaved(item, book.live.accounts, book.today))) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = item.includeBalance, onCheckedChange = { onChange(item.copy(includeBalance = it)) })
                    Text("Set ${reported.first.name}'s balance to ${format.money(reported.second, reported.first.currency)}", style = MaterialTheme.typography.bodyMedium)
                }
            }
            if (!done) {
                item.issues.forEach { Text("• $it", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            item.error?.takeIf { item.status == SmsStatus.ERROR }?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
            }
            item.similar?.takeIf { item.status == SmsStatus.DUPLICATE }?.let { similar ->
                Text(
                    "You recorded “${similar.description.ifEmpty { "an entry" }}” for ${format.money(similar.amount)} on ${Format.date(similar.date)} (${similar.account}). Is this the same?",
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            Text(
                item.text,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = if (expanded) Int.MAX_VALUE else 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.clickable { expanded = !expanded },
            )
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                when {
                    done -> {
                        if (reported != null && SmsImport.needsBalanceSaved(item, book.live.accounts, book.today)) {
                            Button(onClick = { onSaveBalance(reported.first.id, reported.second) }) { Text("Save balance") }
                        }
                        TextButton(onClick = onSkip) { Text("Remove from list") }
                    }
                    item.status == SmsStatus.DUPLICATE -> {
                        val similar = item.similar
                        if (similar != null) Button(onClick = { onSame(similar.id) }) { Text("Same — link it") }
                        OutlinedButton(onClick = onAddAnyway) { Text("Add anyway") }
                        TextButton(onClick = onSkip) { Text("Skip") }
                    }
                    item.status == SmsStatus.IGNORED -> {
                        if (SmsImport.isBalanceOnly(item) && reported != null && item.includeBalance && !item.balanceSaved) {
                            Button(onClick = { onSaveBalance(reported.first.id, reported.second) }) { Text("Save balance") }
                        }
                        if (!SmsImport.isBalanceOnly(item)) OutlinedButton(onClick = onEdit) { Text("It is a transaction") }
                        TextButton(onClick = onSkip) { Text("Skip") }
                    }
                    else -> {
                        if (missing != null && suggestion != null) {
                            Button(onClick = { onCreateAccount(suggestion) }) {
                                Text(if (suggestion.name.isBlank()) "Add an account" else "Add “${suggestion.name}”")
                            }
                        } else {
                            Button(onClick = onAdd, enabled = draft.amount != null && draft.accountId != null) { Text("Add") }
                        }
                        OutlinedButton(onClick = onEdit) { Text("Edit") }
                        TextButton(onClick = onSkip) { Text("Skip") }
                    }
                }
            }
        }
    }
}

/** Changing what a message becomes before it is added. */
@Composable
private fun ColumnScope.SmsItemEditor(book: Book, item: SmsItem, onClose: () -> Unit, onSave: (SmsItem) -> Unit) {
    val draft = item.draft
    val usable = book.live.accounts.filter { it.isActive }
    var type by remember { mutableStateOf(draft.type) }
    var amount by remember { mutableStateOf(draft.amount?.let(Money::editable) ?: "") }
    var accountId by remember { mutableStateOf(draft.accountId) }
    var toAccountId by remember { mutableStateOf(draft.toAccountId) }
    var toAmount by remember { mutableStateOf(draft.toAmount?.let(Money::editable) ?: "") }
    var categoryId by remember { mutableStateOf(draft.categoryId) }
    var scope by remember { mutableStateOf(draft.scope) }
    var countAsExpense by remember { mutableStateOf(draft.countAsExpense) }
    var date by remember { mutableStateOf(draft.date) }
    var time by remember { mutableStateOf(draft.time) }
    var description by remember { mutableStateOf(draft.description) }
    var includeFee by remember { mutableStateOf(item.includeFee) }
    var fee by remember { mutableStateOf(item.fee?.amount?.let(Money::editable) ?: "") }
    var includeBalance by remember { mutableStateOf(item.includeBalance) }

    val from = book.accounts[accountId]
    val to = book.accounts[toAccountId]
    val kind = if (type == EntryType.INCOME) CategoryKind.INCOME else CategoryKind.EXPENSE
    val categories = book.live.categories.filter { it.kind == kind && !it.isArchived }.sortedBy { it.sortOrder }
    val spending = type == EntryType.EXPENSE || (type == EntryType.TRANSFER && countAsExpense)
    val credit = item.parsed.direction == Direction.CREDIT

    Text("Before adding", style = MaterialTheme.typography.titleLarge)
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
        val types = listOf(EntryType.EXPENSE to "Spending", EntryType.INCOME to "Income", EntryType.TRANSFER to "Transfer")
        types.forEachIndexed { index, (value, label) ->
            SegmentedButton(selected = type == value, onClick = {
                if (type != value) {
                    // The message's own account stays the one it is about.
                    val own = SmsImport.ownAccountId(item.copy(draft = item.draft.copy(type = type, accountId = accountId, toAccountId = toAccountId)))
                    type = value
                    if (value == EntryType.TRANSFER && credit) {
                        toAccountId = own
                        accountId = null
                    } else {
                        accountId = own
                        if (value != EntryType.TRANSFER) toAccountId = null
                    }
                    if (book.categories[categoryId]?.kind != (if (value == EntryType.INCOME) CategoryKind.INCOME else CategoryKind.EXPENSE)) categoryId = null
                }
            }, shape = SegmentedButtonDefaults.itemShape(index, types.size)) { Text(label) }
        }
    }
    AmountField("Amount", amount, { amount = it }, prefix = Money.symbol(from?.currency ?: book.format.base))
    PickerField(if (type == EntryType.TRANSFER) "From" else "Account", from, usable, { it.name }, { accountId = it.id })
    if (type == EntryType.TRANSFER) {
        PickerField("To", to, usable.filter { it.id != accountId }, { it.name }, { toAccountId = it.id })
        if (from != null && to != null && from.currency != to.currency) {
            AmountField("Amount received (${to.currency})", toAmount, { toAmount = it }, prefix = Money.symbol(to.currency))
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Count as spending", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
            Switch(checked = countAsExpense, onCheckedChange = { countAsExpense = it })
        }
    }
    if (type != EntryType.TRANSFER || countAsExpense) {
        PickerField("Category", book.categories[categoryId]?.takeIf { it.kind == kind }, categories, { it.name }, {
            categoryId = it.id
            it.defaultScope?.let { s -> scope = s }
        })
    }
    if (spending) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("For", style = MaterialTheme.typography.bodyLarge)
            FilterChip(selected = scope == ExpenseScope.PERSONAL, onClick = { scope = ExpenseScope.PERSONAL }, label = { Text("Personal") })
            FilterChip(selected = scope == ExpenseScope.FAMILY, onClick = { scope = ExpenseScope.FAMILY }, label = { Text("Family") })
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        DateField("Date", date, { date = it }, Modifier.weight(1f))
        TimeField("Time", time, { time = it }, Modifier.weight(1f))
    }
    OutlinedTextField(description, { description = it.take(140) }, label = { Text("Description") }, singleLine = true, modifier = Modifier.fillMaxWidth())
    if (item.fee != null) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Add the fee as its own expense", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
            Switch(checked = includeFee, onCheckedChange = { includeFee = it })
        }
        if (includeFee) AmountField("Fee", fee, { fee = it }, prefix = Money.symbol(from?.currency ?: book.format.base))
    }
    if (item.parsed.balance != null) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Set the balance it reports", style = MaterialTheme.typography.bodyLarge)
                Text(book.format.money(item.parsed.balance ?: 0, item.parsed.balanceCurrency ?: book.format.base), style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Switch(checked = includeBalance, onCheckedChange = { includeBalance = it })
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(Modifier.weight(1f)) {}
        TextButton(onClick = onClose) { Text("Cancel") }
        Button(onClick = {
            val edited = draft.copy(
                type = type,
                amount = Money.parseInput(amount),
                accountId = accountId,
                toAccountId = if (type == EntryType.TRANSFER) toAccountId else null,
                toAmount = if (type == EntryType.TRANSFER) Money.parseInput(toAmount) else null,
                categoryId = if (type != EntryType.TRANSFER || countAsExpense) categoryId else null,
                scope = scope,
                countAsExpense = type == EntryType.TRANSFER && countAsExpense,
                date = date,
                time = time,
                description = description,
            )
            onSave(
                item.copy(
                    draft = edited,
                    fee = item.fee?.copy(amount = Money.parseInput(fee)),
                    includeFee = includeFee && Money.parseInput(fee) != null,
                    includeBalance = includeBalance,
                    status = SmsStatus.REVIEW,
                    issues = emptyList(),
                    error = null,
                    errorField = null,
                    similar = null,
                ),
            )
        }) { Text("Done") }
    }
}
