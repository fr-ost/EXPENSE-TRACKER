@file:OptIn(ExperimentalMaterial3Api::class)

package io.github.fr_ost.hisab.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.fr_ost.hisab.core.CategoryKind
import io.github.fr_ost.hisab.core.Dates
import io.github.fr_ost.hisab.core.Edits
import io.github.fr_ost.hisab.core.EntryType
import io.github.fr_ost.hisab.core.ExpenseScope
import io.github.fr_ost.hisab.core.Frequency
import io.github.fr_ost.hisab.core.Money
import io.github.fr_ost.hisab.core.Recurring
import io.github.fr_ost.hisab.core.RecurringInput
import io.github.fr_ost.hisab.core.Recurrings
import io.github.fr_ost.hisab.data.Outcome
import io.github.fr_ost.hisab.ui.theme.Palette

private fun frequencyLabel(f: Frequency) = when (f) {
    Frequency.WEEKLY -> "Every week"
    Frequency.MONTHLY -> "Every month"
    Frequency.YEARLY -> "Every year"
}

// ---- Recurring ---------------------------------------------------------------

/** Rent, salary, subscriptions: entries Hisab adds by itself when they come due. */
@Composable
fun RecurringScreen(book: Book) {
    val repository = LocalRepository.current
    val messages = LocalMessages.current
    var editing by remember { mutableStateOf<Recurring?>(null) }
    var adding by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf<Recurring?>(null) }
    val rules = book.live.recurring.sortedWith(compareByDescending<Recurring> { it.isActive }.thenBy { it.nextOccurrence ?: "9999" }.thenBy { it.createdAt })
    val upcoming = remember(book) { Recurrings.upcoming(book.live, book.today) }
    val posted = remember(book) { book.live.transactions.groupingBy { it.recurringId }.eachCount() }

    fun act(change: (io.github.fr_ost.hisab.core.LedgerData) -> List<io.github.fr_ost.hisab.core.Synced>, done: String) {
        when (val outcome = repository.edit(change)) {
            Outcome.Done -> messages.show(done)
            is Outcome.Refused -> messages.show(outcome.message)
        }
    }

    Column(Modifier.fillMaxSize()) {
        ScreenBar("Recurring") { TextButton(onClick = { adding = true }) { Text("Add") } }
        LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            if (rules.isEmpty()) {
                item {
                    Empty("Nothing recurring yet", "Rent, salary, bills and subscriptions: added on their day, by themselves.") {
                        Button(onClick = { adding = true }) { Text("Add one") }
                    }
                }
            }
            if (upcoming.isNotEmpty()) {
                item {
                    Section("Next 30 days") {
                        upcoming.take(8).forEachIndexed { index, (rule, date) ->
                            if (index > 0) RowDivider()
                            ListRow(
                                title = rule.description.ifEmpty { book.categories[rule.categoryId]?.name ?: "Recurring" },
                                subtitle = Format.day(date, book.today),
                                trailing = {
                                    val currency = book.accounts[rule.accountId]?.currency ?: book.format.base
                                    AmountText(if (rule.type == EntryType.INCOME) rule.amount else -rule.amount, book.format, currency = currency, signed = rule.type != EntryType.TRANSFER)
                                },
                            )
                        }
                    }
                }
            }
            if (rules.isNotEmpty()) {
                item {
                    Section("Rules") {
                        rules.forEachIndexed { index, rule ->
                            if (index > 0) RowDivider()
                            val account = book.accounts[rule.accountId]
                            ListRow(
                                title = rule.description.ifEmpty { book.categories[rule.categoryId]?.name ?: "Recurring" },
                                subtitle = listOfNotNull(
                                    frequencyLabel(rule.frequency),
                                    account?.name,
                                    if (!rule.isActive) "Paused" else rule.nextOccurrence?.let { "next ${Format.day(it, book.today)}" } ?: "Finished",
                                    posted[rule.id]?.let { "$it added" },
                                ).joinToString(" · "),
                                trailing = { AmountText(rule.amount, book.format, currency = account?.currency ?: book.format.base) },
                                onClick = { editing = rule },
                            )
                        }
                    }
                }
            }
        }
    }

    if (adding || editing != null) {
        val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        val rule = editing
        ModalBottomSheet(onDismissRequest = { adding = false; editing = null }, sheetState = state) {
            Column(
                Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, bottom = 32.dp).imePadding(),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                RecurringEditor(
                    book, rule,
                    onClose = { adding = false; editing = null },
                    onPause = rule?.let { r -> { act({ Recurrings.setActive(it, r.id, !r.isActive, book.today) }, if (r.isActive) "Paused" else "Resumed"); editing = null } },
                    onSkip = rule?.takeIf { it.isActive && it.nextOccurrence != null }?.let { r -> { act({ Recurrings.skipNext(it, r.id) }, "Skipped ${Format.date(r.nextOccurrence ?: "")}"); editing = null } },
                    onDelete = rule?.let { r -> { confirmDelete = r; editing = null } },
                )
            }
        }
    }
    confirmDelete?.let { rule ->
        Confirm("Delete this recurring entry?", "Entries it already added stay in your ledger.", "Delete", onConfirm = {
            act({ Recurrings.delete(it, rule.id) }, "Deleted")
            confirmDelete = null
        }, onDismiss = { confirmDelete = null })
    }
}

@Composable
private fun ColumnScope.RecurringEditor(
    book: Book,
    existing: Recurring?,
    onClose: () -> Unit,
    onPause: (() -> Unit)?,
    onSkip: (() -> Unit)?,
    onDelete: (() -> Unit)?,
) {
    val repository = LocalRepository.current
    val messages = LocalMessages.current
    val usable = book.live.accounts.filter { it.isActive || it.id == existing?.accountId || it.id == existing?.toAccountId }
    var type by remember { mutableStateOf(existing?.type ?: EntryType.EXPENSE) }
    var amount by remember { mutableStateOf(existing?.let { Money.editable(it.amount) } ?: "") }
    var accountId by remember { mutableStateOf(existing?.accountId ?: usable.firstOrNull()?.id) }
    var toAccountId by remember { mutableStateOf(existing?.toAccountId) }
    var toAmount by remember { mutableStateOf(existing?.toAmount?.let(Money::editable) ?: "") }
    var categoryId by remember { mutableStateOf(existing?.categoryId) }
    var scope by remember { mutableStateOf(existing?.scope ?: ExpenseScope.PERSONAL) }
    var countAsExpense by remember { mutableStateOf(existing?.countAsExpense ?: false) }
    var description by remember { mutableStateOf(existing?.description ?: "") }
    var frequency by remember { mutableStateOf(existing?.frequency ?: Frequency.MONTHLY) }
    var startDate by remember { mutableStateOf(existing?.startDate ?: book.today) }
    var endDate by remember { mutableStateOf(existing?.endDate) }
    var hasEnd by remember { mutableStateOf(existing?.endDate != null) }
    var backfill by remember { mutableStateOf(false) }
    var errors by remember { mutableStateOf(mapOf<String, String>()) }

    val from = book.accounts[accountId]
    val to = book.accounts[toAccountId]
    val kind = if (type == EntryType.INCOME) CategoryKind.INCOME else CategoryKind.EXPENSE
    val categories = book.live.categories.filter { it.kind == kind && (!it.isArchived || it.id == existing?.categoryId) }.sortedBy { it.sortOrder }
    val spending = type == EntryType.EXPENSE || (type == EntryType.TRANSFER && countAsExpense)

    Text(if (existing == null) "New recurring entry" else "Recurring entry", style = MaterialTheme.typography.titleLarge)
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
        val types = listOf(EntryType.EXPENSE to "Spending", EntryType.INCOME to "Income", EntryType.TRANSFER to "Transfer")
        types.forEachIndexed { index, (value, label) ->
            SegmentedButton(selected = type == value, onClick = {
                type = value
                if (book.categories[categoryId]?.kind != (if (value == EntryType.INCOME) CategoryKind.INCOME else CategoryKind.EXPENSE)) categoryId = null
            }, shape = SegmentedButtonDefaults.itemShape(index, types.size)) { Text(label) }
        }
    }
    AmountField("Amount", amount, { amount = it }, error = errors["amount"], prefix = Money.symbol(from?.currency ?: book.format.base))
    PickerField(if (type == EntryType.TRANSFER) "From" else "Account", from, usable, { it.name }, { accountId = it.id }, error = errors["accountId"])
    if (type == EntryType.TRANSFER) {
        PickerField("To", to, usable.filter { it.id != accountId }, { it.name }, { toAccountId = it.id }, error = errors["toAccountId"])
        if (from != null && to != null && from.currency != to.currency) {
            AmountField("Amount received (${to.currency})", toAmount, { toAmount = it }, error = errors["toAmount"], prefix = Money.symbol(to.currency))
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
        }, error = errors["categoryId"])
    }
    if (spending) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("For", style = MaterialTheme.typography.bodyLarge)
            FilterChip(selected = scope == ExpenseScope.PERSONAL, onClick = { scope = ExpenseScope.PERSONAL }, label = { Text("Personal") })
            FilterChip(selected = scope == ExpenseScope.FAMILY, onClick = { scope = ExpenseScope.FAMILY }, label = { Text("Family") })
        }
    }
    OutlinedTextField(description, { description = it.take(140) }, label = { Text("Description") }, singleLine = true, modifier = Modifier.fillMaxWidth())
    PickerField("Repeats", frequency, Frequency.entries, ::frequencyLabel, { frequency = it })
    DateField("Starts", startDate, { startDate = it }, error = errors["startDate"] ?: errors["date"])
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("Ends on a date", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Switch(checked = hasEnd, onCheckedChange = {
            hasEnd = it
            if (it && endDate == null) endDate = Dates.addYears(startDate, 1)
        })
    }
    if (hasEnd) DateField("Ends", endDate ?: startDate, { endDate = it }, error = errors["endDate"])
    if (existing == null && startDate < book.today) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Also add the ones already past", style = MaterialTheme.typography.bodyLarge)
                Text("From ${Format.date(startDate)} until today.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Switch(checked = backfill, onCheckedChange = { backfill = it })
        }
    }
    errors[""]?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }

    if (existing != null) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            onPause?.let { TextButton(onClick = it) { Text(if (existing.isActive) "Pause" else "Resume") } }
            onSkip?.let { TextButton(onClick = it) { Text("Skip next") } }
            onDelete?.let { TextButton(onClick = it) { Text("Delete") } }
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(Modifier.weight(1f)) {}
        TextButton(onClick = onClose) { Text("Cancel") }
        Button(onClick = {
            val input = RecurringInput(
                type = type,
                amount = Money.parseInput(amount) ?: 0,
                accountId = accountId.orEmpty(),
                toAccountId = if (type == EntryType.TRANSFER) toAccountId else null,
                toAmount = if (type == EntryType.TRANSFER) Money.parseInput(toAmount) else null,
                categoryId = if (type != EntryType.TRANSFER || countAsExpense) categoryId else null,
                countAsExpense = type == EntryType.TRANSFER && countAsExpense,
                scope = if (spending) scope else null,
                description = description,
                frequency = frequency,
                startDate = startDate,
                endDate = if (hasEnd) endDate else null,
                isActive = existing?.isActive ?: true,
            )
            val outcome = repository.edit { data ->
                if (existing == null) Recurrings.create(data, input, book.today, backfill) else Recurrings.update(data, existing.id, input, book.today)
            }
            when (outcome) {
                Outcome.Done -> {
                    messages.show(if (existing == null) "Added" else "Saved")
                    onClose()
                }
                is Outcome.Refused -> errors = mapOf((outcome.field ?: "") to outcome.message)
            }
        }) { Text(if (existing == null) "Add" else "Save") }
    }
}

// ---- Reports -----------------------------------------------------------------

/** A month or a year: income, spending and savings, by month or day, by category and Personal / Family. */
@Composable
fun ReportsScreen(book: Book) {
    var yearly by rememberSaveable { mutableStateOf(false) }
    var month by rememberSaveable { mutableStateOf(Dates.monthOf(book.today)) }
    var year by rememberSaveable { mutableStateOf(book.today.take(4).toInt()) }
    val fx = book.currencies.conversion
    val format = book.format
    val currentYear = book.today.take(4).toInt()
    val from = if (yearly) "$year-01-01" else Dates.monthStart(month)
    val to = if (yearly) "$year-12-31" else Dates.monthEnd(month)
    val analytics = book.analytics
    val summary = remember(book, from, to) { analytics.periodSummary(from, to, fx) }
    val categories = remember(book, from, to) { analytics.categoryTotals(from, to, fx) }
    val incomeCategories = remember(book, from, to) { analytics.categoryTotals(from, to, fx, CategoryKind.INCOME) }
    val scopes = remember(book, from, to) { analytics.scopeTotals(from, to, fx) }
    val months = remember(book, year, yearly) {
        if (!yearly) emptyList() else analytics.monthlySeries("$year-01", if (year == currentYear) Dates.monthOf(book.today) else "$year-12", fx)
    }
    val daily = remember(book, from, to, yearly) { if (yearly) emptyList() else analytics.dailySpending(from, to, fx) }

    Column(Modifier.fillMaxSize()) {
        ScreenBar("Reports")
        LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = !yearly, onClick = { yearly = false }, label = { Text("Month") })
                    FilterChip(selected = yearly, onClick = { yearly = true }, label = { Text("Year") })
                    Box(Modifier.weight(1f))
                    if (yearly) {
                        TextButton(onClick = { year -= 1 }) { Text("‹") }
                        Text(if (year == currentYear) "$year so far" else "$year", style = MaterialTheme.typography.titleMedium)
                        TextButton(onClick = { year += 1 }, enabled = year < currentYear) { Text("›") }
                    } else {
                        MonthSwitcher(month, { month = it })
                    }
                }
            }
            item {
                Section(null) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        ReportLine("Income", format.money(summary.income))
                        ReportLine("Spending", format.money(summary.expenses))
                        ReportLine("Saved", format.money(summary.netSavings), bold = true)
                        summary.savingsRate?.let { ReportLine("Savings rate", "${Math.round(it)}%") }
                        if (summary.transferCount > 0) ReportLine("Transfers between accounts", "${summary.transferCount} · ${format.money(summary.transfers)}")
                        if (fx.rates.size > 1) {
                            Text("Other currencies are counted at their rate (More → Currencies).", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
            if (yearly && months.isNotEmpty()) {
                item {
                    Section("By month") {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Bars(months.map { Format.month(it.month).take(3) to listOf(it.income, it.expenses) }, listOf(Palette.Positive, Palette.Negative))
                            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                                Legend("Income", Palette.Positive)
                                Legend("Spending", Palette.Negative)
                            }
                            months.maxByOrNull { it.expenses }?.takeIf { it.expenses > 0 }?.let {
                                Text("Most spent in ${Format.month(it.month)}: ${format.money(it.expenses)}", style = MaterialTheme.typography.bodyMedium)
                            }
                        }
                    }
                }
            }
            if (!yearly && daily.any { it.second > 0 }) {
                item {
                    Section("Spending by day") {
                        Column(Modifier.padding(16.dp)) {
                            Bars(daily.map { it.first.takeLast(2).trimStart('0') to listOf(it.second) }, listOf(Palette.Negative), labelEvery = 5)
                        }
                    }
                }
            }
            if (scopes.any { it.total > 0 }) {
                item {
                    Section("Personal and Family") {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            scopes.forEach { s ->
                                Share(if (s.scope == ExpenseScope.FAMILY) "Family" else "Personal", format.money(s.total), s.share)
                            }
                        }
                    }
                }
            }
            if (categories.isNotEmpty()) {
                item {
                    Section("Spending by category") {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            categories.take(12).forEach { Share(it.category.name, "${format.money(it.total)} · ${it.count}", it.share) }
                        }
                    }
                }
            }
            if (incomeCategories.isNotEmpty()) {
                item {
                    Section("Income by category") {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            incomeCategories.take(8).forEach { Share(it.category.name, format.money(it.total), it.share) }
                        }
                    }
                }
            }
            if (summary.income == 0L && summary.expenses == 0L) {
                item { Empty("Nothing in this period", "Entries dated in it show here.") }
            }
        }
    }
}

@Composable
private fun ReportLine(label: String, value: String, bold: Boolean = false) {
    Row(Modifier.fillMaxWidth()) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal)
    }
}

@Composable
private fun Share(label: String, value: String, share: Double) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth()) {
            Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            Text("$value · ${Math.round(share)}%", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        LinearProgressIndicator(progress = { (share / 100).toFloat().coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun Legend(label: String, color: androidx.compose.ui.graphics.Color) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Canvas(Modifier.size(10.dp)) { drawRect(color) }
        Text(label, style = MaterialTheme.typography.bodySmall)
    }
}

/** Simple bars: one group per label, one bar per series. */
@Composable
private fun Bars(groups: List<Pair<String, List<Long>>>, colors: List<androidx.compose.ui.graphics.Color>, labelEvery: Int = 1) {
    val max = groups.maxOfOrNull { g -> g.second.maxOrNull() ?: 0L }?.takeIf { it > 0 } ?: 1L
    val described = groups.joinToString(", ") { "${it.first}: ${it.second.joinToString(" / ")}" }
    Column {
        Canvas(Modifier.fillMaxWidth().height(140.dp).semantics { contentDescription = described }) {
            val slot = size.width / groups.size
            val series = groups.firstOrNull()?.second?.size ?: 1
            val bar = (slot * 0.8f) / series
            groups.forEachIndexed { i, (_, values) ->
                values.forEachIndexed { j, value ->
                    val height = size.height * (value.toFloat() / max)
                    drawRect(colors[j % colors.size], topLeft = Offset(i * slot + slot * 0.1f + j * bar, size.height - height), size = Size(bar * 0.9f, height))
                }
            }
        }
        Row(Modifier.fillMaxWidth()) {
            groups.forEachIndexed { i, (label, _) ->
                Text(if (i % labelEvery == 0) label else "", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f), maxLines = 1)
            }
        }
    }
}

// ---- Currencies --------------------------------------------------------------

/** Rates for the other currencies your accounts use: yours, or the latest conversion's. */
@Composable
fun CurrenciesScreen(book: Book) {
    val repository = LocalRepository.current
    val messages = LocalMessages.current
    val foreign = book.currencies.foreign
    var editing by remember { mutableStateOf<String?>(null) }
    var value by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    Column(Modifier.fillMaxSize()) {
        ScreenBar("Currencies")
        LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item {
                Text(
                    "Totals and reports are in ${book.format.base}. Each other currency is counted at a rate: one you set, or else the rate of your latest transfer between the two.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (foreign.isEmpty()) {
                item { Empty("Only ${book.format.base}", "Accounts in other currencies show their rates here.") }
            } else {
                item {
                    Section(null) {
                        foreign.forEachIndexed { index, f ->
                            if (index > 0) RowDivider()
                            ListRow(
                                title = "1 ${f.currency} = ${f.rate ?: "?"} ${book.format.base}",
                                subtitle = when (f.source) {
                                    io.github.fr_ost.hisab.core.ForeignCurrency.Source.MANUAL -> "Your rate"
                                    io.github.fr_ost.hisab.core.ForeignCurrency.Source.CONVERSION -> "From your transfer on ${f.lastConversion?.second?.let(Format::date) ?: "—"}"
                                    null -> "No rate yet: left out of totals"
                                },
                                onClick = {
                                    editing = f.currency
                                    value = f.manualRate ?: f.rate ?: ""
                                    error = null
                                },
                            )
                        }
                    }
                }
            }
        }
    }
    editing?.let { currency ->
        AlertDialog(
            onDismissRequest = { editing = null },
            title = { Text("Rate for $currency") },
            text = {
                OutlinedTextField(value, { value = it.trim().take(20) }, label = { Text("${book.format.base} for 1 $currency") }, singleLine = true,
                    isError = error != null, supportingText = error?.let { { Text(it) } })
            },
            confirmButton = {
                Button(onClick = {
                    when (val outcome = repository.edit { listOf(Edits.setRate(it, currency, value.ifEmpty { null })) }) {
                        Outcome.Done -> {
                            editing = null
                            messages.show("Rate saved")
                        }
                        is Outcome.Refused -> error = outcome.message
                    }
                }) { Text("Save") }
            },
            dismissButton = {
                Row {
                    if (foreign.firstOrNull { it.currency == currency }?.manualRate != null) {
                        TextButton(onClick = {
                            repository.edit { listOf(Edits.setRate(it, currency, null)) }
                            editing = null
                            messages.show("Using your transfers' rate")
                        }) { Text("Clear") }
                    }
                    TextButton(onClick = { editing = null }) { Text("Cancel") }
                }
            },
        )
    }
}
